// Pokélearning.app: opens your German Pokémon game in the bundled mGBA with the
// companion script already running, and docks the panel next to it.
//
// Launch: server → ROM (asked once) → first-launch setup (downloads, once) →
// mGBA with --script → panel. Quitting mGBA quits the app; quitting the app
// closes mGBA and stops the server.

import AppKit
import Carbon.HIToolbox
import UniformTypeIdentifiers
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private let paths = AppPaths.standard()
  private lazy var server = ServerProcess(paths: paths)
  private var emulator: Process?
  private var panel: PanelController?
  private let hotKeys = HotKeys()
  private let scriptingWindow = ScriptingWindowHider()
  private var setupWindow: NSWindow?
  private var quitting = false
  private var lan = false
  private let phoneItem = NSMenuItem(title: "Allow Phone Access", action: #selector(togglePhone), keyEquivalent: "")

  private var romPath: String? {
    get { UserDefaults.standard.string(forKey: "romPath") }
    set { UserDefaults.standard.set(newValue, forKey: "romPath") }
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // one copy at a time: a second one would fight over the ports
    let others = NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "")
      .filter { $0 != NSRunningApplication.current }
    if let other = others.first {
      other.activate()
      NSApp.terminate(nil)
      return
    }
    buildMenu()
    hotKeys.register(key: kVK_ANSI_P) { [weak self] in self?.showPanel() }
    hotKeys.register(key: kVK_ANSI_D) { [weak self] in self?.panel?.dock() }
    server.onUnexpectedExit = { [weak self] code in self?.serverStopped(code) }
    Task { await launch() }
  }

  // MARK: Launch

  private func launch() async {
    do {
      try await server.start(lan: lan)
    } catch {
      fatal("Pokélearning couldn't start", error.localizedDescription)
      return
    }
    guard let rom = await ensureRom() else { NSApp.terminate(nil); return }
    if !(await setupReady()) {
      showSetupWindow()
      while !(await setupReady()) { try? await Task.sleep(nanoseconds: 1_000_000_000) }
      try? await Task.sleep(nanoseconds: 1_200_000_000) // let "ready" show for a moment
      setupWindow?.close()
      setupWindow = nil
    }
    startEmulator(rom: rom)
    showPanel()
  }

  /// The remembered ROM, or ask for one.
  private func ensureRom() async -> String? {
    if let path = romPath, FileManager.default.fileExists(atPath: path) { return path }
    while true {
      if let chosen = chooseRom() {
        romPath = chosen
        return chosen
      }
      let alert = NSAlert()
      alert.messageText = "Pokélearning needs your game"
      alert.informativeText = "Choose the .gba file of your Pokémon game, dumped from your own cartridge. Pokélearning doesn't include any games."
      alert.addButton(withTitle: "Choose ROM…")
      alert.addButton(withTitle: "Quit")
      if alert.runModal() != .alertFirstButtonReturn { return nil }
    }
  }

  private func chooseRom() -> String? {
    NSApp.activate(ignoringOtherApps: true)
    let open = NSOpenPanel()
    open.title = "Choose your Pokémon ROM"
    open.message = "Choose your Pokémon game (a .gba file dumped from your own cartridge), e.g. Pokémon Smaragd."
    open.prompt = "Play"
    open.allowedContentTypes = [UTType(filenameExtension: "gba") ?? .data]
    open.allowsMultipleSelection = false
    return open.runModal() == .OK ? open.url?.path : nil
  }

  private func setupReady() async -> Bool {
    guard let data = await ServerProcess.get("api/setup"),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
    return json["ready"] as? Bool ?? false
  }

  private func showSetupWindow() {
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 560),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
    window.title = "Pokélearning: first-time setup"
    let web = WKWebView(frame: .zero)
    web.load(URLRequest(url: URL(string: "\(ServerProcess.base)/#/setup")!))
    window.contentView = web
    window.center()
    window.isReleasedWhenClosed = false
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    setupWindow = window
  }

  // MARK: Emulator and panel

  private func startEmulator(rom: String) {
    let p = Process()
    p.executableURL = paths.mgba
    p.arguments = ["--script", paths.luaScript.path, rom]
    p.terminationHandler = { [weak self] proc in
      Task { @MainActor in
        guard let self, self.emulator === proc else { return }
        self.emulator = nil
        if !self.quitting { NSApp.terminate(nil) } // closing the game ends the session
      }
    }
    do {
      try p.run()
      emulator = p
      scriptingWindow.start(pid: p.processIdentifier)
    } catch {
      fatal("mGBA didn't start", "\(error.localizedDescription)\n\nThe app may be incomplete: download it again.")
    }
  }

  private func stopEmulator() {
    guard let p = emulator else { return }
    emulator = nil
    p.terminate()
  }

  private func showPanel() {
    if let panel {
      panel.show()
      return
    }
    let controller = PanelController(options: PanelOptions(url: URL(string: "\(ServerProcess.base)/#/panel")!))
    controller.onClose = {} // the app keeps running; Panel → Show Panel brings it back
    panel = controller
  }

  // MARK: Quitting

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    quitting = true
    stopEmulator()
    server.stop()
    return .terminateNow
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    showPanel()
    return true
  }

  private func serverStopped(_ code: Int32) {
    guard !quitting else { return }
    let alert = NSAlert()
    alert.messageText = "The companion server stopped"
    alert.informativeText = "It exited with code \(code). Restart it to keep getting translations; File → Show Logs has the details."
    alert.addButton(withTitle: "Restart")
    alert.addButton(withTitle: "Quit")
    if alert.runModal() == .alertFirstButtonReturn {
      Task { await restartServer() }
    } else {
      NSApp.terminate(nil)
    }
  }

  private func restartServer() async {
    server.stop()
    do {
      try await server.start(lan: lan)
      panel?.reload()
    } catch {
      fatal("The companion server didn't restart", error.localizedDescription)
    }
  }

  private func fatal(_ title: String, _ text: String) {
    NSApp.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.alertStyle = .critical
    alert.messageText = title
    alert.informativeText = text
    alert.addButton(withTitle: "Quit")
    alert.addButton(withTitle: "Show Logs")
    if alert.runModal() == .alertSecondButtonReturn { NSWorkspace.shared.activateFileViewerSelecting([paths.serverLog]) }
    NSApp.terminate(nil)
  }

  // MARK: Menus

  private func buildMenu() {
    let main = NSMenu()
    func submenu(_ title: String, _ items: [NSMenuItem]) {
      let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
      let menu = NSMenu(title: title)
      items.forEach(menu.addItem)
      item.submenu = menu
      main.addItem(item)
    }
    func item(_ title: String, _ action: Selector, _ key: String = "") -> NSMenuItem {
      let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
      i.target = self
      return i
    }
    let quit = NSMenuItem(title: "Quit Pokélearning", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    submenu("Pokélearning", [item("About Pokélearning", #selector(about)), .separator(), quit])
    submenu("File", [
      item("Change ROM…", #selector(changeRom)),
      .separator(),
      item("Back Up Progress…", #selector(backUp)),
      item("Restore Progress…", #selector(restore)),
      .separator(),
      item("Show Data Folder", #selector(showData)),
      item("Show Logs", #selector(showLogs)),
    ])
    // copy and select in the panel's text
    submenu("Edit", [
      NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"),
      NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"),
    ])
    submenu("Go", [
      item("Live", #selector(openLive), "1"),
      item("Review", #selector(openReview), "2"),
      item("Words", #selector(openWords), "3"),
      item("Games", #selector(openGames), "4"),
    ])
    // Control-Option, not Command: mGBA uses Command-P to pause, and these also work while the game has the keyboard (see HotKeys)
    let show = item("Show Panel", #selector(showPanelAction), "p")
    let dockItem = item("Dock Next to mGBA", #selector(dock), "d")
    [show, dockItem].forEach { $0.keyEquivalentModifierMask = [.control, .option] }
    submenu("Panel", [show, dockItem, .separator(), item("Hide mGBA Scripting Window…", #selector(hideScriptingWindow))])
    phoneItem.target = self
    submenu("Phone", [phoneItem])
    NSApp.mainMenu = main
  }

  private func open(_ route: String) {
    NSWorkspace.shared.open(URL(string: "\(ServerProcess.base)/#/\(route)")!)
  }

  @objc private func openLive() { open("") }
  @objc private func openReview() { open("review") }
  @objc private func openWords() { open("words") }
  @objc private func openGames() { open("games") }
  @objc private func showPanelAction() { showPanel() }
  @objc private func dock() { panel?.dock() }
  @objc private func hideScriptingWindow() { scriptingWindow.hideNow() }
  @objc private func showData() { NSWorkspace.shared.activateFileViewerSelecting([paths.database]) }
  @objc private func showLogs() { NSWorkspace.shared.activateFileViewerSelecting([paths.serverLog]) }

  @objc private func about() {
    let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
    let alert = NSAlert()
    alert.messageText = "Pokélearning \(version)"
    alert.informativeText = """
      Learn German while you play. Includes mGBA (MPL-2.0), Node.js, Opus-MT, \
      a dictionary from Wiktionary (CC BY-SA) and names from PokéAPI. No games are included.
      """
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Licences…")
    if alert.runModal() == .alertSecondButtonReturn { NSWorkspace.shared.open(paths.notices) }
  }

  @objc private func changeRom() {
    guard let chosen = chooseRom() else { return }
    romPath = chosen
    stopEmulator()
    startEmulator(rom: chosen)
  }

  @objc private func backUp() {
    let save = NSSavePanel()
    let day = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withFullDate])
    save.nameFieldStringValue = "Pokelearning-backup-\(day).db"
    save.allowedContentTypes = [UTType(filenameExtension: "db") ?? .data]
    save.message = "Your history, word bank, reviews and game results, in one file."
    guard save.runModal() == .OK, let url = save.url else { return }
    Task {
      do {
        _ = try await ServerProcess.post("api/backup", json: ["path": url.path])
        NSWorkspace.shared.activateFileViewerSelecting([url])
      } catch {
        message("The backup didn't work", error.localizedDescription)
      }
    }
  }

  @objc private func restore() {
    let open = NSOpenPanel()
    open.title = "Restore progress"
    open.message = "Choose a Pokélearning backup (.db), or the data/app.db of an earlier copy."
    open.allowedContentTypes = [UTType(filenameExtension: "db") ?? .data]
    guard open.runModal() == .OK, let source = open.url else { return }
    let confirm = NSAlert()
    confirm.messageText = "Replace your current progress?"
    confirm.informativeText = "Your current progress is kept as a copy in the data folder, so you can go back."
    confirm.addButton(withTitle: "Replace")
    confirm.addButton(withTitle: "Cancel")
    guard confirm.runModal() == .alertFirstButtonReturn else { return }
    server.stop()
    let fm = FileManager.default
    let stamp = Int(Date().timeIntervalSince1970)
    do {
      if fm.fileExists(atPath: paths.database.path) {
        try fm.copyItem(at: paths.database, to: paths.data.appendingPathComponent("app.before-restore-\(stamp).db"))
        for suffix in ["", "-wal", "-shm"] {
          try? fm.removeItem(at: URL(fileURLWithPath: paths.database.path + suffix))
        }
      }
      try fm.copyItem(at: source, to: paths.database)
    } catch {
      message("Restoring didn't work", error.localizedDescription)
    }
    Task { await restartServer() }
  }

  @objc private func togglePhone() {
    lan.toggle()
    phoneItem.state = lan ? .on : .off
    Task {
      await restartServer()
      if lan {
        let addresses = Host.current().addresses.filter { $0.contains(".") && !$0.hasPrefix("127.") && !$0.hasPrefix("169.254.") }
        message("Open this on your phone", addresses.map { "http://\($0):\(ServerProcess.uiPort)" }.joined(separator: "\n")
          + "\n\nThe phone has to be on the same Wi-Fi. If macOS asks whether to allow incoming connections, allow them.")
      }
    }
  }

  private func message(_ title: String, _ text: String) {
    let alert = NSAlert()
    alert.messageText = title
    alert.informativeText = text
    alert.runModal()
  }
}

@main
struct PokelearningApp {
  static func main() {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    withExtendedLifetime(delegate) { app.run() }
  }
}
