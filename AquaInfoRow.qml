import QtQuick
import qs.Commons

Item {
  id: root
  property string label: ""
  property string value: ""
  property color foreground: Color.popups.text
  property color valueColor: foreground
  property string fontFamily: Style.font.family
  property bool valueBold: false
  implicitHeight: Math.max(labelText.implicitHeight, valueText.implicitHeight)

  Text {
    id: labelText
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    text: root.label
    color: Util.alpha(root.foreground, 0.55)
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
  }
  Text {
    id: valueText
    anchors.left: labelText.right
    anchors.leftMargin: Style.space(10)
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    text: root.value
    textFormat: Text.PlainText
    color: root.valueColor
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
    font.bold: root.valueBold
    horizontalAlignment: Text.AlignRight
    elide: Text.ElideMiddle
  }
}
