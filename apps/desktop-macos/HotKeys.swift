// Shortcuts that work while the game has the keyboard (the panel never takes focus, so
// menu shortcuts only fire when Pokélearning itself is in front). Control-Option-letter is
// used because mGBA's own shortcuts are Command-based. Registered with the system, which
// needs no special permission.

import Carbon.HIToolbox

@MainActor
final class HotKeys {
  private static var actions: [UInt32: () -> Void] = [:]
  private static var handler: EventHandlerRef?
  private var refs: [EventHotKeyRef?] = []
  private var nextID: UInt32 = 1

  /// `key` is a kVK_ANSI_* code; fires with Control and Option held.
  func register(key: Int, _ action: @escaping @MainActor () -> Void) {
    if HotKeys.handler == nil {
      var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
      InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
        var hotKeyID = EventHotKeyID()
        GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                          MemoryLayout<EventHotKeyID>.size, nil, &hotKeyID)
        let id = hotKeyID.id
        DispatchQueue.main.async { MainActor.assumeIsolated { HotKeys.actions[id]?() } }
        return noErr
      }, 1, &spec, nil, &HotKeys.handler)
    }
    let id = nextID
    nextID += 1
    HotKeys.actions[id] = action
    var ref: EventHotKeyRef?
    RegisterEventHotKey(UInt32(key), UInt32(controlKey | optionKey), EventHotKeyID(signature: OSType(0x504B4C4E), id: id),
                        GetApplicationEventTarget(), 0, &ref)
    refs.append(ref)
  }
}
