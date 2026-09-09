import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons
import qs.Ui

Item {
  id: root
  property var service: null
  readonly property bool shown: service && (service.recording || service.processing || service.phase === "complete" || service.phase === "error")
  readonly property bool recording: service && service.recording

  PanelWindow {
    visible: root.shown
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "aqua-voice-hud"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore
    mask: Region {}

    BorderSurface {
      width: Math.max(Style.space(158), hudContent.implicitWidth + Style.space(24))
      height: Style.space(34)
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      anchors.bottomMargin: Style.space(52)
      color: Util.alpha(Color.background, 0.96)
      borderSpec: Border.surfaceSpec("popups", "border", Color.popups.border, Math.max(1, Style.space(1)))
      radius: height / 2

      Row {
        id: hudContent
        anchors.centerIn: parent
        spacing: Style.space(7)

        Image {
          width: Style.space(18)
          height: width
          source: Qt.resolvedUrl("assets/aqua-orb.png")
          fillMode: Image.PreserveAspectFit
          smooth: true
        }

        Row {
          visible: root.recording
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(2)
          Repeater {
            model: 5
            Rectangle {
              required property int index
              width: Style.space(2)
              height: Style.space(5 + ((index * 5) % 10))
              radius: width / 2
              color: Color.accent
              SequentialAnimation on scale {
                running: root.recording
                loops: Animation.Infinite
                NumberAnimation { to: 1.35; duration: 180 + index * 35 }
                NumberAnimation { to: 0.72; duration: 220 + index * 30 }
              }
            }
          }
        }

        Text {
          anchors.verticalCenter: parent.verticalCenter
          text: root.recording ? "Recording"
            : (service && service.phase === "complete" ? service.completion
              : (service && service.phase === "error" ? "Dictation failed"
                : (service && String(service.stage).indexOf("retry") >= 0 ? "Retrying Aqua…"
                  : "Transcribing · " + Math.floor((service ? service.processingMs : 0) / 1000) + "s")))
          color: service && service.phase === "error" ? Color.urgent : Color.popups.text
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          font.bold: true
        }
      }
    }
  }
}
