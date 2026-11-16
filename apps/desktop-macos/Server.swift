// The bundled companion server: Contents/Resources/node running
// Contents/Resources/server/server.mjs, with its data in
// ~/Library/Application Support/Pokélearning and its output in
// ~/Library/Logs/Pokélearning/server.log.

import Foundation

struct AppPaths {
  let resources: URL
  let data: URL
  let logs: URL

  var node: URL { resources.appendingPathComponent("node") }
  var serverScript: URL { resources.appendingPathComponent("server/server.mjs") }
  var web: URL { resources.appendingPathComponent("web") }
  var luaScript: URL { resources.appendingPathComponent("mgba-lua/main.lua") }
  var mgba: URL { resources.appendingPathComponent("mGBA.app/Contents/MacOS/mGBA") }
  var notices: URL { resources.appendingPathComponent("THIRD_PARTY_NOTICES.md") }
  var database: URL { data.appendingPathComponent("app.db") }
  var serverLog: URL { logs.appendingPathComponent("server.log") }

  static func standard() -> AppPaths {
    let fm = FileManager.default
    // POKELEARNING_RESOURCES lets a developer run the binary outside the bundle
    let resources = ProcessInfo.processInfo.environment["POKELEARNING_RESOURCES"].map { URL(fileURLWithPath: $0) }
      ?? Bundle.main.resourceURL!
    let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Pokélearning")
    let logs = fm.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Logs/Pokélearning")
    try? fm.createDirectory(at: support, withIntermediateDirectories: true)
    try? fm.createDirectory(at: logs, withIntermediateDirectories: true)
    return AppPaths(resources: resources, data: support, logs: logs)
  }
}

enum ServerError: LocalizedError {
  case portInUse(Int)
  case didNotStart(String)

  var errorDescription: String? {
    switch self {
    case .portInUse(let port):
      return "Port \(port) is already in use. Is the companion already running from a terminal (npm run play)? Stop it, then open Pokélearning again."
    case .didNotStart(let log):
      return "The companion server didn't start. Its log is at \(log)."
    }
  }
}

@MainActor
final class ServerProcess {
  nonisolated static let uiPort = 8766
  nonisolated static let adapterPort = 8765
  nonisolated static var base: URL { URL(string: "http://localhost:\(uiPort)")! }

  private let paths: AppPaths
  private var process: Process?
  /// Called if the server stops without being asked to.
  var onUnexpectedExit: (Int32) -> Void = { _ in }

  init(paths: AppPaths) {
    self.paths = paths
  }

  /// GET a server path; nil if nothing answers.
  nonisolated static func get(_ path: String, timeout: TimeInterval = 2) async -> Data? {
    var request = URLRequest(url: base.appendingPathComponent(path))
    request.timeoutInterval = timeout
    guard let (data, response) = try? await URLSession.shared.data(for: request),
          (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
    return data
  }

  nonisolated static func post(_ path: String, json: [String: Any] = [:]) async throws -> Data {
    var request = URLRequest(url: base.appendingPathComponent(path))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = try JSONSerialization.data(withJSONObject: json)
    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
      throw NSError(domain: "Pokélearning", code: status, userInfo: [NSLocalizedDescriptionKey: message ?? "HTTP \(status)"])
    }
    return data
  }

  func start(lan: Bool = false) async throws {
    if await ServerProcess.get("api/status", timeout: 1) != nil { throw ServerError.portInUse(ServerProcess.uiPort) }

    let fm = FileManager.default
    if !fm.fileExists(atPath: paths.serverLog.path) { fm.createFile(atPath: paths.serverLog.path, contents: nil) }
    let log = try FileHandle(forWritingTo: paths.serverLog)
    log.seekToEndOfFile()
    log.write("\n--- \(Date()) starting ---\n".data(using: .utf8)!)

    let p = Process()
    p.executableURL = paths.node
    p.arguments = [paths.serverScript.path]
    var env = ProcessInfo.processInfo.environment
    env["DATA_DIR"] = paths.data.path
    env["WEB_DIST_DIR"] = paths.web.path
    env["FORCE_COLOR"] = "0"
    env["NO_COLOR"] = "1"
    if lan { env["UI_HOST"] = "0.0.0.0" }
    p.environment = env
    p.standardOutput = log
    p.standardError = log
    p.terminationHandler = { [weak self] proc in
      let code = proc.terminationStatus
      Task { @MainActor in
        guard let self, self.process === proc else { return } // stop() clears it first: expected
        self.process = nil
        self.onUnexpectedExit(code)
      }
    }
    try p.run()
    process = p

    for _ in 0..<120 {
      if await ServerProcess.get("api/status", timeout: 1) != nil { return }
      if process == nil { break }
      try await Task.sleep(nanoseconds: 250_000_000)
    }
    stop()
    throw ServerError.didNotStart(paths.serverLog.path)
  }

  /// Stop the server and wait for it, so the database is closed cleanly.
  func stop() {
    guard let p = process else { return }
    process = nil
    p.terminate()
    let deadline = Date().addingTimeInterval(5)
    while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
    if p.isRunning { kill(p.processIdentifier, SIGKILL) }
  }

  var isRunning: Bool { process?.isRunning ?? false }
}
