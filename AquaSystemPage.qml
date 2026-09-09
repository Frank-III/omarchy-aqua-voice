import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

Item {
  id: root
  property var svc: null
  property color foreground: Color.popups.text
  property string fontFamily: Style.font.family
  signal actionRequested(var args)

  readonly property bool online: svc && svc.phase !== "offline"

  function scrollBy(delta) {
    var flick = scrollArea.contentItem
    if (!flick) return
    flick.contentY = Math.max(0, Math.min(Math.max(0, flick.contentHeight - flick.height), flick.contentY + delta))
  }

  AquaPageHeader {
    id: header
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: parent.top
    title: "System"
    subtitle: "Connection status and local activity"
    foreground: root.foreground
    fontFamily: root.fontFamily
    Button { text: root.online ? "Stop backend" : "Start backend"; onClicked: root.actionRequested([root.online ? "stop" : "start"]) }
  }
  Rectangle { id: rule; anchors.left: parent.left; anchors.right: parent.right; anchors.top: header.bottom; height: 1; color: Util.alpha(root.foreground, 0.12) }

  ScrollView {
    id: scrollArea
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: rule.bottom
    anchors.bottom: parent.bottom
    anchors.topMargin: Style.space(14)
    clip: true
    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
    ScrollBar.vertical.policy: column.implicitHeight > height ? ScrollBar.AsNeeded : ScrollBar.AlwaysOff
    Column {
      id: column
      width: scrollArea.availableWidth
      spacing: Style.space(12)

      AquaCard {
        width: parent.width
        foreground: root.foreground
        PanelSectionHeader { text: "Health"; foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Backend"; value: root.online ? "Running" : "Stopped"; valueColor: root.online ? Color.accent : Color.urgent; foreground: root.foreground; fontFamily: root.fontFamily; valueBold: true }
        AquaInfoRow { width: parent.width; label: "Aqua account"; value: root.svc && root.svc.tokenPresent ? "Token available" : "Sign-in needed"; valueColor: root.svc && root.svc.tokenPresent ? Color.accent : Color.urgent; foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Physical hotkey"; value: root.svc && root.svc.hotkeyReady ? "Ready" : (root.online ? "Unavailable" : "Backend stopped"); foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "WebSocket"; value: root.svc && root.svc.websocketConnected ? (root.svc.recording ? "Connected · recording" : "Connected · finalizing") : "Disconnected"; foreground: root.foreground; fontFamily: root.fontFamily }
      }

      AquaCard {
        width: parent.width
        foreground: root.foreground
        PanelSectionHeader { text: "Protocol"; foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Transport"; value: "WSS · binary PCM frames"; foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Audio"; value: "16 kHz · mono · s16le"; foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Version"; value: root.svc ? root.svc.backendVersion || "Unavailable" : "Unavailable"; foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Runtime"; value: "JavaScript · Bun"; foreground: root.foreground; fontFamily: root.fontFamily }
      }

      AquaCard {
        width: parent.width
        foreground: root.foreground
        PanelSectionHeader { text: "Stats"; foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Words in local history"; value: String(root.svc ? root.svc.history.reduce(function(n, entry) { return n + (entry.text.trim() ? entry.text.trim().split(/\s+/).length : 0) }, 0) : 0); foreground: root.foreground; fontFamily: root.fontFamily; valueBold: true }
        AquaInfoRow { width: parent.width; label: "Local history"; value: (root.svc ? root.svc.history.length : 0) + " / 20"; foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Last audio"; value: root.svc && root.svc.lastAudioMs > 0 ? (root.svc.lastAudioMs / 1000).toFixed(1) + "s" : "--"; foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Last finalization"; value: root.svc && root.svc.lastLatencyMs > 0 ? (root.svc.lastLatencyMs / 1000).toFixed(1) + "s" : "--"; foreground: root.foreground; fontFamily: root.fontFamily }
      }


    }
  }
}
