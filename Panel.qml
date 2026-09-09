import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

Panel {
  id: root
  moduleName: "frankmi.aqua-voice"
  ipcTarget: "frankmi.aqua-voice"
  manageIpc: false

  readonly property var svc: bar && bar.shell ? bar.shell.serviceFor(root.moduleName) : null
  readonly property string control: Qt.resolvedUrl("bin/aqua-voice-control").toString().replace(/^file:\/\//, "")
  readonly property color fg: bar ? bar.foreground : Color.popups.text
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  property string page: "dictate"
  property string actionInput: ""
  property string actionMessage: ""
  property bool actionFailed: false
  property var actionOwner: null

  readonly property string phase: svc ? svc.phase : "offline"
  readonly property bool online: phase !== "offline"
  readonly property bool recording: phase === "recording"
  readonly property bool processing: phase === "processing"
  readonly property bool complete: phase === "complete"
  readonly property var currentPage: page === "history" ? historyPage : page === "dictionary" ? dictionaryPage : page === "account" ? accountPage : page === "settings" ? settingsPage : page === "system" ? systemPage : dictatePage

  implicitWidth: barRow.implicitWidth
  implicitHeight: barRow.implicitHeight

  readonly property string statusTitle: {
    if (!online) return "Backend stopped"
    if (phase === "armed") return "Tap again"
    if (recording) return "Listening"
    if (processing) return "Transcribing · " + Math.floor((svc ? svc.processingMs : 0) / 1000) + "s"
    if (complete) return svc && svc.completion ? svc.completion : "Complete"
    if (phase === "error") return "Needs attention"
    if (!svc || !svc.tokenPresent) return "Sign in to dictate"
    return "Ready"
  }
  readonly property string statusDetail: {
    if (!online) return "Start Aqua to enable realtime dictation"
    if (phase === "armed") return "Second tap starts hands-free dictation"
    if (recording) return svc && svc.liveText ? svc.liveText : "Tap once when you are done"
    if (processing) return svc && svc.stage ? String(svc.stage).replace(/-/g, " ") : "Waiting for Aqua"
    if (complete) return svc && svc.completion !== "No text returned" && svc.completion !== "Too short" ? svc.latestTranscript : ""
    if (phase === "error") return svc ? svc.lastError : "Unknown error"
    if (!svc || !svc.tokenPresent) return "Open Account to sign in to Aqua Voice"
    return "Double-tap " + (svc ? svc.hotkeyDisplay : "Shift+Super+F23")
  }

  function goto(target) { page = target }
  function cyclePage(direction) {
    var order = ["dictate", "history", "dictionary", "account", "settings", "system"]
    var index = Math.max(0, order.indexOf(page))
    page = order[(index + direction + order.length) % order.length]
  }
  function scrollCurrent(amount) {
    if (currentPage && typeof currentPage.scrollBy === "function") currentPage.scrollBy(amount)
  }
  function run(args, input) {
    if (action.running) return
    actionMessage = ""
    actionOwner = currentPage
    if ((args[0] === "trigger" && (args[1] === "paste-last" || args[1] === "start")) || args[0] === "paste-history") root.close()
    actionInput = typeof input === "string" ? input : ""
    action.stdinEnabled = actionInput !== ""
    action.command = [control].concat(args)
    action.running = true
  }
  function primaryAction() {
    if (!online) run(["start"])
    else if (recording) run(["trigger", "stop"])
    else if (!processing) run(["trigger", "start"])
  }

  IpcHandler {
    target: root.ipcTarget
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function page(name: string): void { root.goto(name) }
    function state(): string {
      return JSON.stringify({
        page: root.page,
        phase: root.phase,
        online: root.online,
        recording: root.recording,
        processing: root.processing
      })
    }
  }

  Process {
    id: action
    stdinEnabled: false
    stdout: StdioCollector {}
    stderr: StdioCollector {}
    onStarted: if (root.actionInput !== "") write(root.actionInput + "\n")
    onExited: function(exitCode) {
      var payload = null
      try { payload = JSON.parse(exitCode === 0 ? action.stdout.text : action.stderr.text) } catch (_) {}
      root.actionFailed = exitCode !== 0 || Boolean(payload && payload.ok === false)
      root.actionMessage = root.actionFailed ? (payload && payload.error ? String(payload.error) : "Action failed. Please try again.") : "Done"
      if (root.actionOwner && typeof root.actionOwner.actionFinished === "function") root.actionOwner.actionFinished(!root.actionFailed)
      stdinEnabled = false
      root.actionInput = ""
      if (root.svc) refreshDelay.restart()
    }
  }
  Timer { id: refreshDelay; interval: 120; onTriggered: if (root.svc) root.svc.refresh() }

  // Only the open Dictionary page probes the account revision; this is not
  // part of the one-second local status refresh.
  Process {
    id: dictionaryProbe
    command: [root.control, "dictionary", "probe"]
    stdout: StdioCollector {}
    stderr: StdioCollector {}
    onExited: function(exitCode) {
      if (root.svc) root.svc.refresh()
      if (exitCode !== 0 && root.opened && root.page === "dictionary") {
        var result = null
        try { result = JSON.parse(dictionaryProbe.stderr.text) } catch (_) {}
        root.actionFailed = true
        root.actionMessage = result && result.error ? result.error : "Could not check dictionary updates"
      }
    }
  }
  Timer {
    interval: 7000
    running: root.opened && root.page === "dictionary" && root.svc && root.svc.tokenPresent
    repeat: true
    triggeredOnStart: true
    onTriggered: if (!dictionaryProbe.running && !action.running) dictionaryProbe.running = true
  }

  Row {
    id: barRow
    anchors.centerIn: parent
    spacing: Style.space(4)
    WidgetButton {
      id: button
      bar: root.bar
      text: ""
      labelVisible: false
      hasVisualContent: true
      fixedWidth: barBrand.implicitWidth + Style.spaceReal(10)
      active: root.recording || root.processing || root.complete
      tooltipText: "Aqua Voice · " + root.statusTitle
      opacity: root.online ? 1 : 0.62
      onPressed: function(buttonCode) {
        if (buttonCode === Qt.RightButton) root.run(["trigger", "paste-last"])
        else root.toggle()
      }
      Row {
        id: barBrand
        anchors.centerIn: parent
        spacing: Style.spaceReal(4)
        Image {
          anchors.verticalCenter: parent.verticalCenter
          width: Style.spaceReal(16)
          height: width
          source: Qt.resolvedUrl("assets/aqua-orb.png")
          fillMode: Image.PreserveAspectFit
          smooth: true
        }
        Text {
          anchors.verticalCenter: parent.verticalCenter
          text: "AQUA"
          color: button.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          font.bold: true
          font.letterSpacing: 0.7
        }
      }
    }
    Text {
      anchors.verticalCenter: button.verticalCenter
      visible: root.recording || root.processing
      text: root.recording ? "REC" : "…"
      color: Color.accent
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      font.bold: true
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: barRow
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(660))
    contentHeight: panel.fittedContentHeight(Style.space(600), Style.space(600))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: action.running || (root.currentPage && root.currentPage.editing === true)
      onActivateRequested: root.primaryAction()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onMoveRequested: function(dx, dy) {
        if (dy !== 0) root.scrollCurrent(dy * Style.space(64))
        else if (dx !== 0) root.cyclePage(dx)
      }
      onTextKey: function(text) {
        if (text === "1") root.goto("dictate")
        else if (text === "2") root.goto("history")
        else if (text === "3") root.goto("dictionary")
        else if (text === "4") root.goto("account")
        else if (text === "5") root.goto("settings")
        else if (text === "6") root.goto("system")
        else if (text === "r") root.run(["trigger", "paste-last"])
        else if (text === "c" && root.recording) root.run(["trigger", "cancel"])
      }

      Item {
        id: sidebar
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: Style.space(132)

        Column {
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.top: parent.top
          anchors.rightMargin: Style.space(12)
          spacing: Style.space(4)
          Item {
            width: parent.width
            height: Style.space(44)
            Image {
              id: brandOrb
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              width: Style.space(25)
              height: width
              source: Qt.resolvedUrl("assets/aqua-orb.png")
              fillMode: Image.PreserveAspectFit
              opacity: root.online ? 1 : 0.45
            }
            Column {
              anchors.left: brandOrb.right
              anchors.leftMargin: Style.space(7)
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(1)
              Text { width: parent.width; text: "AQUA"; color: root.fg; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall; font.bold: true; font.letterSpacing: 1.1; elide: Text.ElideRight }
              Text { width: parent.width; text: root.online ? "ONLINE" : "OFFLINE"; color: Util.alpha(root.fg, 0.45); font.family: root.fontFamily; font.pixelSize: Style.font.caption }
            }
          }
          NavButton { width: parent.width; pageId: "dictate"; glyph: "󰍬"; title: "Dictate" }
          NavButton { width: parent.width; pageId: "history"; glyph: "󰋚"; title: "History" }
          NavButton { width: parent.width; pageId: "dictionary"; glyph: "󰓆"; title: "Dictionary" }
          NavButton { width: parent.width; pageId: "account"; glyph: "󰀄"; title: "Account" }
          NavButton { width: parent.width; pageId: "settings"; glyph: "󰒓"; title: "Settings" }
          NavButton { width: parent.width; pageId: "system"; glyph: "󰒋"; title: "System" }
        }

        Column {
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.bottom: parent.bottom
          anchors.rightMargin: Style.space(12)
          spacing: Style.space(5)
          Rectangle { width: parent.width; height: 1; color: Util.alpha(root.fg, 0.12) }
          Item { width: 1; height: Style.space(3) }
          MiniStat { width: parent.width; glyph: "󰗊"; value: root.svc ? root.svc.language.toUpperCase() : "EN" }
          MiniStat { width: parent.width; glyph: "󰍛"; value: (root.svc ? root.svc.history.length : 0) + " saved" }
          MiniStat { width: parent.width; glyph: "󰔟"; value: root.svc && root.svc.lastLatencyMs > 0 ? (root.svc.lastLatencyMs / 1000).toFixed(1) + "s" : "--" }
          Item { width: 1; height: Style.space(4) }
        }
      }

      Rectangle { id: railRule; anchors.left: sidebar.right; anchors.top: parent.top; anchors.bottom: parent.bottom; width: 1; color: Util.alpha(root.fg, 0.12) }

      Item {
        id: pageHost
        anchors.left: railRule.right
        anchors.leftMargin: Style.space(14)
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: actionNotice.top
        anchors.bottomMargin: actionNotice.visible ? Style.space(10) : 0
        enabled: !action.running

        AquaHomePage { id: dictatePage; anchors.fill: parent; visible: root.page === "dictate"; svc: root.svc; foreground: root.fg; fontFamily: root.fontFamily; statusTitle: root.statusTitle; statusDetail: root.statusDetail; onActionRequested: function(args) { root.run(args) } }
        AquaHistoryPage {
          id: historyPage
          anchors.fill: parent
          visible: root.page === "history"
          svc: root.svc
          foreground: root.fg
          fontFamily: root.fontFamily
          onActionRequested: function(args) {
            if (args[0] === "paste-history") root.close()
            root.run(args)
          }
        }
        AquaDictionaryPage { id: dictionaryPage; anchors.fill: parent; visible: root.page === "dictionary"; svc: root.svc; foreground: root.fg; fontFamily: root.fontFamily; onActionRequested: function(args, input) { root.run(args, input) } }
        AquaAccountPage {
          id: accountPage
          anchors.fill: parent
          visible: root.page === "account"
          svc: root.svc
          foreground: root.fg
          fontFamily: root.fontFamily
          onActionRequested: function(args) {
            if (args[0] === "auth" && args[1] === "login") root.close()
            root.run(args)
          }
        }
        AquaSettingsPage { id: settingsPage; anchors.fill: parent; visible: root.page === "settings"; svc: root.svc; foreground: root.fg; fontFamily: root.fontFamily; actionBusy: action.running; onActionRequested: function(args) { root.run(args) } }
        AquaSystemPage { id: systemPage; anchors.fill: parent; visible: root.page === "system"; svc: root.svc; foreground: root.fg; fontFamily: root.fontFamily; onActionRequested: function(args) { root.run(args) } }
      }
      Text {
        id: actionNotice
        anchors.left: railRule.right
        anchors.leftMargin: Style.space(14)
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: visible ? implicitHeight : 0
        visible: action.running || root.actionMessage !== ""
        text: action.running ? "Working…" : root.actionMessage
        textFormat: Text.PlainText
        color: root.actionFailed ? Color.urgent : Util.alpha(root.fg, 0.65)
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        wrapMode: Text.Wrap
      }

    }
  }

  component NavButton: Rectangle {
    id: nav
    required property string pageId
    required property string glyph
    required property string title
    readonly property bool selected: root.page === pageId
    height: Style.space(34)
    radius: Style.cornerRadius
    color: selected ? Util.alpha(Color.accent, 0.16) : navMouse.containsMouse ? Util.alpha(root.fg, 0.07) : "transparent"
    MouseArea { id: navMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.goto(nav.pageId) }
    Rectangle { anchors.left: parent.left; anchors.verticalCenter: parent.verticalCenter; width: Style.space(2); height: parent.height * 0.55; radius: width; color: Color.accent; visible: nav.selected }
    Text { id: navGlyph; anchors.left: parent.left; anchors.leftMargin: Style.space(12); anchors.verticalCenter: parent.verticalCenter; text: nav.glyph; color: nav.selected ? Color.accent : Util.alpha(root.fg, 0.7); font.family: root.fontFamily; font.pixelSize: Style.font.icon }
    Text { anchors.left: navGlyph.right; anchors.leftMargin: Style.space(9); anchors.right: parent.right; anchors.rightMargin: Style.space(6); anchors.verticalCenter: parent.verticalCenter; text: nav.title; color: nav.selected ? Color.accent : Util.alpha(root.fg, 0.85); font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall; font.bold: nav.selected; elide: Text.ElideRight }
  }

  component MiniStat: Item {
    id: stat
    required property string glyph
    required property string value
    implicitHeight: statValue.implicitHeight
    Text { id: statGlyph; anchors.left: parent.left; anchors.verticalCenter: parent.verticalCenter; text: stat.glyph; color: Util.alpha(root.fg, 0.45); font.family: root.fontFamily; font.pixelSize: Style.font.caption }
    Text { id: statValue; anchors.left: statGlyph.right; anchors.leftMargin: Style.space(5); anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter; text: stat.value; color: Util.alpha(root.fg, 0.7); font.family: root.fontFamily; font.pixelSize: Style.font.caption; horizontalAlignment: Text.AlignRight; elide: Text.ElideRight }
  }
}
