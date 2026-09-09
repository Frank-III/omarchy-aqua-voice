import QtQuick
import QtQuick.Controls as QQC
import qs.Commons
import qs.Ui

Column {
  id: root
  property var svc: null
  property color foreground: Color.popups.text
  property string fontFamily: Style.font.family
  property string oldFrom: ""
  property string pendingRemove: ""
  property string pendingAction: ""
  property bool instructionsDirty: false
  readonly property bool editing: fromField.activeFocus || toField.activeFocus || instructions.activeFocus
  signal actionRequested(var args, string input)
  spacing: Style.space(12)

  function submit(input, kind) {
    pendingAction = kind
    actionRequested(["customize"], JSON.stringify(input))
  }
  function actionFinished(ok) {
    if (ok && pendingAction === "replacement") {
      fromField.text = ""
      toField.text = ""
      oldFrom = ""
      preserve.checked = true
      punctuation.checked = false
    }
    if (ok && pendingAction === "instructions") instructionsDirty = false
    pendingAction = ""
  }
  function loadInstructions() {
    if (!instructionsDirty && !instructions.activeFocus) instructions.text = svc ? svc.customInstructions : ""
  }
  Component.onCompleted: loadInstructions()
  onSvcChanged: loadInstructions()
  Connections {
    target: root.svc
    function onCustomInstructionsChanged() { root.loadInstructions() }
  }

  AquaCard {
    width: parent.width
    foreground: root.foreground
    PanelSectionHeader { text: "Replacements"; foreground: root.foreground; fontFamily: root.fontFamily }
    Text { width: parent.width; text: "Replace a spoken phrase with the text you want written."; wrapMode: Text.Wrap; color: Util.alpha(root.foreground, 0.55); font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
    Repeater {
      model: root.svc ? root.svc.replacements : []
      Column {
        required property var modelData
        width: parent.width
        spacing: Style.space(4)
        Text { width: parent.width; text: modelData.from + " → " + modelData.to; textFormat: Text.PlainText; wrapMode: Text.Wrap; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.body }
        Row {
          spacing: Style.space(6)
          Button {
            text: "Edit"
            onClicked: {
              root.oldFrom = modelData.from
              fromField.text = modelData.from
              toField.text = modelData.to
              preserve.checked = modelData.preserveCase !== false
              punctuation.checked = modelData.neverAddPunctuation === true
              fromField.forceActiveFocus()
            }
          }
          Button {
            text: root.pendingRemove === modelData.from ? "Confirm remove" : "Remove"
            onClicked: {
              if (root.pendingRemove !== modelData.from) root.pendingRemove = modelData.from
              else {
                root.submit({ type: "replacement_remove", from: modelData.from }, "remove")
                root.pendingRemove = ""
              }
            }
          }
        }
      }
    }
    TextField { id: fromField; width: parent.width; placeholderText: "When I say…"; foreground: root.foreground; font.family: root.fontFamily }
    TextField { id: toField; width: parent.width; placeholderText: "Write this instead…"; foreground: root.foreground; font.family: root.fontFamily }
    Toggle { id: preserve; checked: true; width: parent.width; label: "Preserve case"; description: "Keep the replacement's capitalization."; foreground: root.foreground; fontFamily: root.fontFamily; onClicked: checked = !checked }
    Toggle { id: punctuation; width: parent.width; label: "No added punctuation"; description: "Do not add punctuation to this replacement."; foreground: root.foreground; fontFamily: root.fontFamily; onClicked: checked = !checked }
    Row {
      spacing: Style.space(6)
      Button {
        text: root.oldFrom ? "Save replacement" : "Add replacement"
        enabled: root.svc && root.svc.tokenPresent && fromField.text.trim() !== "" && toField.text.trim() !== ""
        onClicked: root.submit({ type: "replacement_upsert", oldFrom: root.oldFrom, replacement: { from: fromField.text, to: toField.text, preserveCase: preserve.checked, neverAddPunctuation: punctuation.checked } }, "replacement")
      }
      Button { visible: root.oldFrom !== ""; text: "Cancel edit"; onClicked: { root.oldFrom = ""; fromField.text = ""; toField.text = ""; preserve.checked = true; punctuation.checked = false } }
    }
  }
  AquaCard {
    width: parent.width
    foreground: root.foreground
    PanelSectionHeader { text: "Writing instructions"; foreground: root.foreground; fontFamily: root.fontFamily }
    Text { width: parent.width; text: "Tell Aqua how you prefer your dictation written. Changes are saved to your Aqua account."; wrapMode: Text.Wrap; color: Util.alpha(root.foreground, 0.55); font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall }
    QQC.TextArea {
      id: instructions
      width: parent.width
      implicitHeight: Math.max(Style.space(130), contentHeight + Style.space(20))
      placeholderText: "For example: use short paragraphs and keep technical terms unchanged."
      color: root.foreground
      placeholderTextColor: Util.alpha(root.foreground, 0.4)
      selectionColor: Color.accent
      wrapMode: TextEdit.Wrap
      textFormat: TextEdit.PlainText
      font.family: root.fontFamily
      font.pixelSize: Style.font.body
      padding: Style.space(10)
      background: Rectangle { color: Util.alpha(root.foreground, 0.04); radius: Style.cornerRadius; border.width: 1; border.color: instructions.activeFocus ? Color.accent : Util.alpha(root.foreground, 0.15) }
      onTextChanged: if (activeFocus) root.instructionsDirty = true
    }
    Row {
      spacing: Style.space(6)
      Button { text: "Save instructions"; enabled: root.instructionsDirty && root.svc && root.svc.tokenPresent; onClicked: root.submit({ type: "custom_instructions", text: instructions.text }, "instructions") }
      Button { text: "Discard changes"; enabled: root.instructionsDirty; onClicked: { root.instructionsDirty = false; instructions.text = root.svc ? root.svc.customInstructions : "" } }
    }
  }
}
