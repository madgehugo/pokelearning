// ocr-capture: read the text in part of a window with Apple Vision (macOS 14+).
//
//   ocr-capture --list
//       Windows you can capture, as JSON lines: {"app": "mGBA", "title": "…", "id": 123}
//   ocr-capture --window mGBA [--crop x,y,w,h] [--interval 0.5] [--lang de-DE] [--save crop.png]
//       Capture the first window whose app name or title contains "mGBA" every 0.5 s and
//       print what it reads, one JSON object per line: {"text": "…", "confidence": 0.93, "at": 1731…}
//   ocr-capture --image screenshot.png [--crop …] [--lang de-DE] [--save crop.png]
//       Read an image file once (for testing a crop).
//
// --crop takes fractions of the window: x, y (from the top left), width, height.
// The default, 0,0.62,1,0.38, is the bottom of the screen, where Gen 3 shows its text box.
// Live capture needs Screen Recording permission for the terminal (System Settings →
// Privacy & Security → Screen & System Audio Recording).

import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers
import Vision

struct Options {
  var list = false
  var window: String?
  var image: String?
  var crop = CGRect(x: 0, y: 0.62, width: 1, height: 0.38)
  var interval = 0.5
  var languages = ["de-DE"]
  var correction = true
  var save: String?
}

func fail(_ message: String) -> Never {
  emit(["error": message])
  exit(1)
}

func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) else { return }
  print(line)
  fflush(stdout)
}

func parseOptions() -> Options {
  var o = Options()
  var args = CommandLine.arguments.dropFirst().makeIterator()
  while let arg = args.next() {
    switch arg {
    case "--list": o.list = true
    case "--window": o.window = args.next()
    case "--image": o.image = args.next()
    case "--interval": o.interval = Double(args.next() ?? "") ?? o.interval
    case "--lang": o.languages = (args.next() ?? "de-DE").split(separator: ",").map(String.init)
    case "--no-correction": o.correction = false
    case "--save": o.save = args.next()
    case "--crop":
      let parts = (args.next() ?? "").split(separator: ",").compactMap { Double($0) }
      guard parts.count == 4 else { fail("--crop needs four numbers: x,y,width,height (fractions, e.g. 0,0.62,1,0.38)") }
      o.crop = CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
    default: fail("unknown option \(arg)")
    }
  }
  return o
}

/// Cut out the text area, and scale small captures up with sharp pixels: Vision reads
/// pixel fonts better when each game pixel is several screen pixels.
func prepare(_ image: CGImage, crop: CGRect) -> CGImage? {
  let w = Double(image.width), h = Double(image.height)
  let rect = CGRect(x: crop.minX * w, y: crop.minY * h, width: crop.width * w, height: crop.height * h).integral
  guard let cropped = image.cropping(to: rect) else { return nil }
  let scale = max(1, Int((360 / Double(cropped.height)).rounded(.up)))
  if scale == 1 { return cropped }
  let space = CGColorSpaceCreateDeviceRGB()
  guard let ctx = CGContext(data: nil, width: cropped.width * scale, height: cropped.height * scale, bitsPerComponent: 8,
                            bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return cropped }
  ctx.interpolationQuality = .none
  ctx.draw(cropped, in: CGRect(x: 0, y: 0, width: ctx.width, height: ctx.height))
  return ctx.makeImage() ?? cropped
}

func save(_ image: CGImage, to path: String) {
  let url = URL(fileURLWithPath: path) as CFURL
  guard let dest = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil) else { return }
  CGImageDestinationAddImage(dest, image, nil)
  CGImageDestinationFinalize(dest)
}

/// Text lines top to bottom, and the mean confidence.
func recognize(_ image: CGImage, options: Options) throws -> (lines: [String], confidence: Double) {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.recognitionLanguages = options.languages
  request.usesLanguageCorrection = options.correction
  try VNImageRequestHandler(cgImage: image).perform([request])
  let observations = (request.results ?? []).sorted {
    // Vision's origin is bottom left: higher boxes first, then left to right
    abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.02 ? $0.boundingBox.midY > $1.boundingBox.midY : $0.boundingBox.minX < $1.boundingBox.minX
  }
  let candidates = observations.compactMap { $0.topCandidates(1).first }
  let confidence = candidates.isEmpty ? 0 : candidates.map { Double($0.confidence) }.reduce(0, +) / Double(candidates.count)
  return (candidates.map(\.string), confidence)
}

func report(_ image: CGImage, options: Options) {
  guard let prepared = prepare(image, crop: options.crop) else { fail("the crop is outside the image") }
  if let path = options.save { save(prepared, to: path) }
  do {
    let (lines, confidence) = try recognize(prepared, options: options)
    emit(["text": lines.joined(separator: "\n"), "confidence": (confidence * 100).rounded() / 100,
          "at": Int(Date().timeIntervalSince1970 * 1000)])
  } catch {
    emit(["error": "text recognition failed: \(error.localizedDescription)"])
  }
}

@main
struct OcrCapture {
  static func main() async {
    let options = parseOptions()

    if let path = options.image {
      guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fail("can't read the image \(path)") }
      report(image, options: options)
      return
    }

    let content: SCShareableContent
    do {
      content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
    } catch {
      fail("can't list windows (\(error.localizedDescription)). Give your terminal Screen Recording permission: System Settings → Privacy & Security → Screen & System Audio Recording.")
    }

    if options.list {
      for w in content.windows where w.frame.width > 50 {
        emit(["app": w.owningApplication?.applicationName ?? "", "title": w.title ?? "", "id": Int(w.windowID)])
      }
      return
    }

    guard let query = options.window?.lowercased() else { fail("say which window to read: --window mGBA (or --list, or --image file.png)") }
    guard let window = content.windows.first(where: {
      ($0.owningApplication?.applicationName.lowercased().contains(query) ?? false) || ($0.title?.lowercased().contains(query) ?? false)
    }) else { fail("no window matches \"\(query)\". Is it open and on screen? See --list.") }

    let filter = SCContentFilter(desktopIndependentWindow: window)
    let config = SCStreamConfiguration()
    config.width = Int(window.frame.width * 2)
    config.height = Int(window.frame.height * 2)
    config.showsCursor = false
    emit(["status": "reading \(window.owningApplication?.applicationName ?? "") \"\(window.title ?? "")\""])
    while true {
      do {
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        report(image, options: options)
      } catch {
        emit(["error": "capture failed: \(error.localizedDescription)"])
      }
      try? await Task.sleep(nanoseconds: UInt64(options.interval * 1_000_000_000))
    }
  }
}
