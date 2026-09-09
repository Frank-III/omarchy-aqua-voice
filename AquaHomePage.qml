import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

Item {
  id: root
  property var svc: null
  property color foreground: Color.popups.text
  property string fontFamily: Style.font.family
  property string statusTitle: "Ready"
  property string statusDetail: ""
  signal actionRequested(var args)

  readonly property string phase: svc ? svc.phase : "offline"
  readonly property bool online: phase !== "offline"
  readonly property bool recording: phase === "recording"
  readonly property bool processing: phase === "processing"

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
    title: root.svc && root.svc.setupRequired ? "Welcome to Aqua Voice" : "Dictate"
    subtitle: root.svc && root.svc.setupRequired ? "One-time setup · no administrator access needed" : online ? "Speak naturally. Aqua writes it for you." : "Backend stopped · settings remain available"
    foreground: root.foreground
    fontFamily: root.fontFamily
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
        Item {
          width: parent.width
          implicitHeight: Style.space(62)
          Image {
            id: orb
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            width: Style.space(44)
            height: width
            source: Qt.resolvedUrl("assets/aqua-orb.png")
            fillMode: Image.PreserveAspectFit
            opacity: root.online ? 1 : 0.35
            SequentialAnimation on scale {
              running: root.recording
              loops: Animation.Infinite
              NumberAnimation { to: 1.14; duration: 320 }
              NumberAnimation { to: 0.94; duration: 430 }
            }
          }
          Column {
            anchors.left: orb.right
            anchors.leftMargin: Style.space(14)
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(4)
            Text {
              width: parent.width
              text: root.statusTitle
              color: root.recording || root.processing ? Color.accent : root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
            }
            Text {
              width: parent.width
              text: root.statusDetail
              textFormat: Text.PlainText
              color: Util.alpha(root.foreground, 0.5)
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              maximumLineCount: 2
              wrapMode: Text.Wrap
              elide: Text.ElideRight
            }
          }
        }
        Text {
          visible: root.svc && root.svc.setupRequired
          width: parent.width
          text: "Installs the backend for your account and enables it at login. Registers Aqua login links if no other app handles them. Your shortcuts and existing settings stay unchanged."
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.Wrap
        }
        Toggle {
          id: replaceHandler
          visible: root.svc && root.svc.setupRequired && root.svc.loginHandlerConflict
          width: parent.width
          label: "Use this client for Aqua login links"
          description: "Replaces the existing handler and saves it for restoration. Needed for browser sign-in here; leave off to keep login links in the other app."
          foreground: root.foreground
          fontFamily: root.fontFamily
          checked: false
          onClicked: checked = !checked
        }
        Row {
          width: parent.width
          spacing: Style.space(8)
          Button {
            width: root.recording || root.processing ? (parent.width - parent.spacing) * 0.68 : parent.width
            text: root.svc && root.svc.setupRequired ? "Install and enable" : !root.online ? "Start backend" : (root.recording ? "Finish dictation" : "Start dictation")
            enabled: !root.processing && (!root.online || root.recording || (root.svc && root.svc.tokenPresent))
            onClicked: {
              if (root.svc && root.svc.setupRequired) {
                var args = ["setup"]
                if (replaceHandler.visible && replaceHandler.checked) args.push("--replace-login-handler")
                root.actionRequested(args)
              } else if (!root.online) root.actionRequested(["start"])
              else root.actionRequested(["trigger", root.recording ? "stop" : "start"])
            }
          }
          Button {
            visible: root.recording || root.processing
            width: (parent.width - parent.spacing) * 0.32
            text: "Cancel"
            onClicked: root.actionRequested(["trigger", "cancel"])
          }
        }
      }

      AquaCard {
        width: parent.width
        visible: root.svc && root.svc.latestTranscript !== ""
        foreground: root.foreground
        Row {
          width: parent.width
          Text { width: parent.width - pasteButton.width; text: "LAST DICTATION"; color: Util.alpha(root.foreground, 0.5); font.family: root.fontFamily; font.pixelSize: Style.font.caption; font.letterSpacing: 0.8 }
          Button { id: pasteButton; text: "Paste"; onClicked: root.actionRequested(["trigger", "paste-last"]) }
        }
        Text {
          width: parent.width
          text: root.svc ? root.svc.latestTranscript : ""
          textFormat: Text.PlainText
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          wrapMode: Text.Wrap
          maximumLineCount: 4
          elide: Text.ElideRight
        }
      }

      AquaCard {
        width: parent.width
        visible: !root.svc || !root.svc.setupRequired
        foreground: root.foreground
        PanelSectionHeader { text: "Workflow"; foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Activation"; value: "Double-tap " + (root.svc ? root.svc.hotkeyDisplay : "Shift+Super+F23"); foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Microphone"; value: "PipeWire default"; foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Paste"; value: "Focused Hyprland window"; foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Overlay"; value: "Compact, click-through"; foreground: root.foreground; fontFamily: root.fontFamily }
      }

      Text {
        width: parent.width
        text: "Unofficial community client. The Aqua Voice team is working on an official Linux client. Audio is sent to Aqua for transcription."
        color: Util.alpha(root.foreground, 0.42)
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        wrapMode: Text.WordWrap
      }
    }
  }
}
