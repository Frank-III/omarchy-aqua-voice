import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

Item {
  id: root
  property var svc: null
  property color foreground: Color.popups.text
  property string fontFamily: Style.font.family
  property string pendingRemove: ""
  property bool pendingAdd: false
  readonly property bool editing: addField.activeFocus || personalization.editing
  signal actionRequested(var args, string input)

  function addWord() {
    var word = addField.text.trim()
    if (word.length < 1 || word.length > 100) return
    pendingAdd = true
    root.actionRequested(["dictionary", "add"], word)
  }

  function actionFinished(ok) {
    if (ok && pendingAdd) { addField.text = ""; addField.focus = false }
    pendingAdd = false
    personalization.actionFinished(ok)
  }

  function removeWord(word) {
    if (pendingRemove !== word) {
      pendingRemove = word
      return
    }
    pendingRemove = ""
    root.actionRequested(["dictionary", "remove"], word)
  }

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
    title: "Dictionary"
    subtitle: root.svc && root.svc.customizationSyncedAt ? "Last synced " + Qt.formatDateTime(new Date(root.svc.customizationSyncedAt), "MMM d, hh:mm") : "Account personalization · not synced yet"
    foreground: root.foreground
    fontFamily: root.fontFamily
    Button {
      text: "Refresh"
      onClicked: root.actionRequested(["dictionary", "sync"], "")
    }
  }

  Rectangle {
    id: rule
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: header.bottom
    height: 1
    color: Util.alpha(root.foreground, 0.12)
  }

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
        PanelSectionHeader {
          text: "Add a word or phrase"
          foreground: root.foreground
          fontFamily: root.fontFamily
        }
        Row {
          width: parent.width
          spacing: Style.space(8)
          TextField {
            id: addField
            width: parent.width - addButton.width - parent.spacing
            placeholderText: "Omarchy, project name, technical term…"
            foreground: root.foreground
            accent: Color.accent
            font.family: root.fontFamily
            maximumLength: 100
            onAccepted: root.addWord()
            Keys.onEscapePressed: {
              text = ""
              focus = false
            }
          }
          Button {
            id: addButton
            text: "Add"
            enabled: root.svc && root.svc.tokenPresent && addField.text.trim().length > 0
            onClicked: root.addWord()
          }
        }
        Text {
          width: parent.width
          text: "Names and technical terms help Aqua recognize the words you use. Changes apply to future dictations on your account."
          color: Util.alpha(root.foreground, 0.45)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }
      }

      AquaCard {
        width: parent.width
        foreground: root.foreground
        visible: root.svc && root.svc.dictionary.length > 0
        PanelSectionHeader {
          text: "Custom words"
          foreground: root.foreground
          fontFamily: root.fontFamily
        }
        Repeater {
          model: root.svc ? root.svc.dictionary : []
          Item {
            required property string modelData
            width: column.width - Style.space(24)
            implicitHeight: Math.max(wordText.implicitHeight, removeButton.implicitHeight)
            Text {
              id: wordText
              anchors.left: parent.left
              anchors.right: removeButton.left
              anchors.rightMargin: Style.space(10)
              anchors.verticalCenter: parent.verticalCenter
              text: modelData
              textFormat: Text.PlainText
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              elide: Text.ElideRight
            }
            Button {
              id: removeButton
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              text: root.pendingRemove === modelData ? "Confirm" : "Remove"
              onClicked: root.removeWord(modelData)
            }
          }
        }
      }

      Text {
        width: parent.width
        visible: !root.svc || root.svc.dictionary.length === 0
        text: "No custom dictionary words yet."
        color: Util.alpha(root.foreground, 0.45)
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        horizontalAlignment: Text.AlignHCenter
      }
      AquaPersonalization {
        id: personalization
        width: parent.width
        svc: root.svc
        foreground: root.foreground
        fontFamily: root.fontFamily
        onActionRequested: function(args, input) { root.actionRequested(args, input) }
      }

    }
  }
}
