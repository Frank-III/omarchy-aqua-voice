import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

Item {
  id: root
  property var svc: null
  property color foreground: Color.popups.text
  property string fontFamily: Style.font.family
  property bool confirmLogout: false
  readonly property bool connected: svc && svc.tokenPresent
  readonly property bool editing: false
  signal actionRequested(var args)

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
    title: "Account"
    subtitle: root.connected ? "Sign-in token saved" : "Connect your Aqua subscription"
    foreground: root.foreground
    fontFamily: root.fontFamily
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
        Item {
          width: parent.width
          implicitHeight: Style.space(58)
          Image {
            id: accountOrb
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            width: Style.space(42)
            height: width
            source: Qt.resolvedUrl("assets/aqua-orb.png")
            fillMode: Image.PreserveAspectFit
            opacity: root.connected ? 1 : 0.4
          }
          Column {
            anchors.left: accountOrb.right
            anchors.leftMargin: Style.space(14)
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(3)
            Text {
              width: parent.width
              text: root.connected ? (root.svc.accountName || "Aqua account") : "Sign in to Aqua Voice"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.subtitle
              font.bold: true
              elide: Text.ElideRight
            }
            Text {
              width: parent.width
              text: root.connected ? root.svc.accountEmail : "Use Aqua's official browser login"
              color: Util.alpha(root.foreground, 0.5)
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              elide: Text.ElideRight
            }
          }
        }

        AquaInfoRow {
          visible: root.connected
          width: parent.width
          label: "Plan"
          value: root.svc && root.svc.accountPlan ? root.svc.accountPlan : "Not available"
          foreground: root.foreground
          fontFamily: root.fontFamily
          valueBold: true
        }
        AquaInfoRow {
          visible: root.connected
          width: parent.width
          label: "Last account check"
          value: root.svc && root.svc.accountValidatedAt ? Qt.formatDateTime(new Date(root.svc.accountValidatedAt), "MMM d, yyyy hh:mm") : "Not checked"
          foreground: root.foreground
          fontFamily: root.fontFamily
        }

        Button {
          width: parent.width
          visible: !root.connected
          text: "Sign in with browser"
          onClicked: root.actionRequested(["auth", "login"])
        }
        Button {
          width: parent.width
          visible: root.connected
          text: root.confirmLogout ? "Confirm sign out" : "Sign out"
          onClicked: {
            if (!root.confirmLogout) root.confirmLogout = true
            else {
              root.confirmLogout = false
              root.actionRequested(["auth", "logout"])
            }
          }
        }
      }

      Button {
        width: parent.width
        visible: root.connected
        text: "Refresh account"
        onClicked: root.actionRequested(["auth", "refresh"])
      }
    }
  }
}
