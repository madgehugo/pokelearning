// Standalone panel, used by `npm run play`:
//
//   pokelearning-panel [--url http://localhost:8766/#/panel] [--width 380] [--app mGBA]
//
// Close the panel to quit it. The docking itself lives in PanelCore.swift.

import AppKit

func parseOptions() -> PanelOptions {
  var o = PanelOptions()
  var args = CommandLine.arguments.dropFirst().makeIterator()
  while let arg = args.next() {
    switch arg {
    case "--url": if let u = args.next().flatMap(URL.init(string:)) { o.url = u }
    case "--width": if let w = args.next().flatMap(Double.init) { o.width = CGFloat(w) }
    case "--app": if let a = args.next() { o.app = a }
    default:
      FileHandle.standardError.write("unknown option \(arg)\n".data(using: .utf8)!)
      exit(1)
    }
  }
  return o
}

@main
struct PanelApp {
  static func main() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory) // no Dock icon; the panel is the app
    let controller = PanelController(options: parseOptions())
    controller.onClose = { NSApp.terminate(nil) }
    withExtendedLifetime(controller) { app.run() }
  }
}
