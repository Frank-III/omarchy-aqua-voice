import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

Item {
  id: root
  property var svc: null
  property color foreground: Color.popups.text
  property string fontFamily: Style.font.family
  property bool actionBusy: false
  property bool hotkeyCaptureRequested: false
  readonly property bool editing: languagePicker.popupOpen
  signal actionRequested(var args)

  onActionBusyChanged: if (!actionBusy) hotkeyCaptureRequested = false

  function toggle(key) { root.actionRequested(["settings", "toggle", key]) }
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
    title: "Settings"
    subtitle: "Language, shortcut, and transcription preferences"
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
        PanelSectionHeader { text: "Dictation"; foreground: root.foreground; fontFamily: root.fontFamily }
        SearchableDropdown {
          id: languagePicker
          width: parent.width
          label: "Language"
          value: root.svc ? root.svc.language : "en"
          options: root.svc ? root.svc.supportedLanguages : []
          foreground: root.foreground
          fontFamily: root.fontFamily
          onChanged: function(value) { root.actionRequested(["settings", "set", "language", value]) }
        }
        AquaInfoRow { width: parent.width; label: "Model"; value: root.svc ? root.svc.transcriptionModel : "avalon-v1.1"; foreground: root.foreground; fontFamily: root.fontFamily; valueBold: true }
        AquaInfoRow { width: parent.width; label: "Realtime"; value: "Always · 16 kHz mono PCM"; foreground: root.foreground; fontFamily: root.fontFamily }
      }

      AquaCard {
        width: parent.width
        foreground: root.foreground
        PanelSectionHeader { text: "Activation"; foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow {
          width: parent.width
          label: "Current shortcut"
          value: root.svc ? root.svc.hotkeyDisplay : "Shift+Super+F23"
          foreground: root.foreground
          fontFamily: root.fontFamily
          valueBold: true
        }
        Button {
          width: parent.width
          text: root.hotkeyCaptureRequested && root.actionBusy ? "Press a shortcut…  Esc to cancel" : "Record hotkey"
          enabled: !root.actionBusy
          onClicked: {
            root.hotkeyCaptureRequested = true
            root.actionRequested(["record-hotkey"])
          }
        }
        Text {
          width: parent.width
          text: "Choose an unused shortcut within 15 seconds. Existing bindings for that chord will be replaced. Escape keeps the current shortcut."
          color: Util.alpha(root.foreground, 0.45)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }
      }

      Toggle {
        width: parent.width
        label: "Privacy Mode"
        description: "Do not retain new transcripts or learn from them."
        foreground: root.foreground
        accent: Color.accent
        fontFamily: root.fontFamily
        checked: root.svc && root.svc.privacyMode
        onClicked: root.toggle("privacyMode")
      }
      Toggle {
        width: parent.width
        label: "Continual Learning"
        description: "Let Aqua learn preferences from feedback. Disables Privacy Mode."
        foreground: root.foreground
        accent: Color.accent
        fontFamily: root.fontFamily
        checked: root.svc && root.svc.memory
        onClicked: root.toggle("memory")
      }
      Toggle {
        width: parent.width
        label: "Refine transcript"
        description: "Use Aqua's language pass after transcription."
        foreground: root.foreground
        accent: Color.accent
        fontFamily: root.fontFamily
        checked: root.svc && !root.svc.skipLlm
        onClicked: root.toggle("skipLlm")
      }
      Toggle {
        width: parent.width
        label: "Casual Messaging"
        description: "Allow lowercase phrasing in chat apps."
        foreground: root.foreground
        accent: Color.accent
        fontFamily: root.fontFamily
        checked: root.svc && root.svc.casualMessaging
        onClicked: root.toggle("casualMessaging")
      }

      AquaCard {
        width: parent.width
        foreground: root.foreground
        PanelSectionHeader { text: "Personalization"; foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Dictionary"; value: (root.svc ? root.svc.dictionaryCount : 0) + " words"; foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Replacements"; value: String(root.svc ? root.svc.replacementCount : 0); foreground: root.foreground; fontFamily: root.fontFamily }
        AquaInfoRow { width: parent.width; label: "Custom Instructions"; value: root.svc && root.svc.customInstructionsConfigured ? "Configured" : "Not set"; foreground: root.foreground; fontFamily: root.fontFamily }
        Text {
          width: parent.width
          text: "Edit words, replacements, and writing instructions on the Dictionary page."
          color: Util.alpha(root.foreground, 0.44)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }
      }
    }
  }
}
