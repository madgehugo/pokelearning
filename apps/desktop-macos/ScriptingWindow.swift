// mGBA opens its scripting window whenever it starts with --script, and has no
// setting to stop that. Closing the window doesn't stop the script. Closing
// another app's window needs the Accessibility permission, which we ask for
// once; without it the window just stays open (it can be closed by hand).

import AppKit
import ApplicationServices

@MainActor final class ScriptingWindowHider {
  private var timer: Timer?
  private var checks = 0

  /// Ask for permission once, then close mGBA's scripting window as soon as it shows up.
  func start(pid: pid_t) {
    if !AXIsProcessTrusted() && !askForPermission() { return }
    checks = 0
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.tick(pid: pid) }
    }
  }

  private func tick(pid: pid_t) {
    checks += 1
    let done = AXIsProcessTrusted() && closeScriptingWindows(pid: pid)
    if done || checks > 150 { timer?.invalidate() } // gives up after a minute
  }

  private func askForPermission() -> Bool {
    let key = "askedAccessibility"
    if UserDefaults.standard.bool(forKey: key) { return false }
    UserDefaults.standard.set(true, forKey: key)
    let alert = NSAlert()
    alert.messageText = "Hide mGBA's scripting window?"
    alert.informativeText = "mGBA opens a scripting window in front of the game. Pokélearning can close it for you if you allow it under System Settings → Privacy & Security → Accessibility. It only closes that window. Without this, close it by hand; the game keeps working."
    alert.addButton(withTitle: "Allow…")
    alert.addButton(withTitle: "Not now")
    guard alert.runModal() == .alertFirstButtonReturn else { return false }
    _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary)
    return true // the permission arrives while we keep checking
  }

  /// True once a scripting window was found and closed.
  private func closeScriptingWindows(pid: pid_t) -> Bool {
    let app = AXUIElementCreateApplication(pid)
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) == .success,
          let windows = value as? [AXUIElement] else { return false }
    var closed = false
    for window in windows {
      var title: CFTypeRef?
      AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &title)
      guard (title as? String)?.localizedCaseInsensitiveContains("script") == true else { continue }
      var button: CFTypeRef?
      if AXUIElementCopyAttributeValue(window, kAXCloseButtonAttribute as CFString, &button) == .success,
         let button, CFGetTypeID(button) == AXUIElementGetTypeID() {
        closed = AXUIElementPerformAction(button as! AXUIElement, kAXPressAction as CFString) == .success || closed
      }
    }
    return closed
  }
}
