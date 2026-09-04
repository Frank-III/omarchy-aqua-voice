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

  function shortTime(stamp) {
    var date = new Date(String(stamp || ""))
    return isNaN(date.getTime()) ? "" : Qt.formatDateTime(date, "MMM d · h:mm ap")
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
    title: "History"
    subtitle: svc && svc.privacyMode ? "Privacy Mode · new results are not retained" : "Last 20 dictations · stored locally"
    foreground: root.foreground
    fontFamily: root.fontFamily
    Button { text: "Clear all"; enabled: root.svc && root.svc.history.length > 0; onClicked: root.actionRequested(["clear-history"]) }
  }
  Rectangle { id: rule; anchors.left: parent.left; anchors.right: parent.right; anchors.top: header.bottom; height: 1; color: Util.alpha(root.foreground, 0.12) }

  Text {
    anchors.centerIn: parent
    visible: !root.svc || root.svc.history.length === 0
    text: "No local history yet"
    color: Util.alpha(root.foreground, 0.45)
    font.family: root.fontFamily
    font.pixelSize: Style.font.body
  }

  ScrollView {
    id: scrollArea
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: rule.bottom
    anchors.bottom: parent.bottom
    anchors.topMargin: Style.space(14)
    visible: root.svc && root.svc.history.length > 0
    clip: true
    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
    ScrollBar.vertical.policy: column.implicitHeight > height ? ScrollBar.AsNeeded : ScrollBar.AlwaysOff
    Column {
      id: column
      width: scrollArea.availableWidth
      spacing: Style.space(10)
      Repeater {
        model: root.svc ? root.svc.history : []
        AquaCard {
          required property var modelData
          width: column.width
          foreground: root.foreground
          Text {
            width: parent.width
            text: root.shortTime(modelData.createdAt) + (modelData.targetClass ? "  ·  " + modelData.targetClass : "")
            color: Util.alpha(root.foreground, 0.45)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            elide: Text.ElideRight
          }
          Text {
            width: parent.width
            text: modelData.text
            textFormat: Text.PlainText
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.Wrap
            maximumLineCount: 4
            elide: Text.ElideRight
          }
          Row {
            width: parent.width
            spacing: Style.space(8)
            Text {
              width: parent.width - historyActions.width - parent.spacing
              anchors.verticalCenter: parent.verticalCenter
              text: (Number(modelData.audioMs || 0) / 1000).toFixed(1) + "s audio  ·  " + (Number(modelData.latencyMs || 0) / 1000).toFixed(1) + "s finalization"
              color: Util.alpha(root.foreground, 0.42)
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }
            Row {
              id: historyActions
              spacing: Style.space(6)
              Button {
                text: "Copy"
                onClicked: root.actionRequested(["copy-history", modelData.id])
              }
              Button {
                text: "Paste"
                onClicked: root.actionRequested(["paste-history", modelData.id])
              }
            }
          }
        }
      }
    }
  }
}
