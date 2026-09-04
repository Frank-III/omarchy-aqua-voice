import QtQuick
import qs.Commons

Item {
  id: root
  default property alias actions: actionRow.data
  property string title: ""
  property string subtitle: ""
  property color foreground: Color.popups.text
  property string fontFamily: Style.font.family

  implicitHeight: Math.max(titleColumn.implicitHeight, actionRow.implicitHeight) + Style.space(14)

  Column {
    id: titleColumn
    anchors.left: parent.left
    anchors.right: actionRow.left
    anchors.rightMargin: Style.space(12)
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(2)
    Text {
      width: parent.width
      text: root.title
      textFormat: Text.PlainText
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.heading
      font.bold: true
      elide: Text.ElideRight
    }
    Text {
      width: parent.width
      visible: root.subtitle !== ""
      text: root.subtitle
      textFormat: Text.PlainText
      color: Util.alpha(root.foreground, 0.5)
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      elide: Text.ElideRight
    }
  }
  Row {
    id: actionRow
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(8)
  }
}
