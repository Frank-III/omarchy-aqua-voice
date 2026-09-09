import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root
  visible: false
  width: 0
  height: 0

  property var shell: null
  property var manifest: null
  readonly property string pluginDir: manifest && manifest.__sourceDir
    ? String(manifest.__sourceDir)
    : Quickshell.env("HOME") + "/.config/omarchy/plugins/frankmi.aqua-voice"
  readonly property string runner: pluginDir + "/bin/aqua-voice-control"

  property int revision: 0
  property string phase: "offline"
  property bool setupRequired: false
  property bool loginHandlerConflict: false
  property string stage: ""
  property string completion: ""
  property bool recording: false
  property bool processing: false
  property bool hotkeyReady: false
  property int hotkeyTaps: 0
  property string hotkeyDisplay: "Shift+Super+F23"
  property string microphone: "PipeWire default"
  property bool pasteWithShift: false
  property bool tokenPresent: false
  property string accountEmail: ""
  property string accountName: ""
  property string accountPlan: ""
  property string accountValidatedAt: ""
  property string latestTranscript: ""
  property string liveText: ""
  property string lastError: ""
  property int processingMs: 0
  property int lastLatencyMs: 0
  property int lastAudioMs: 0
  property string language: "en"
  property var savedLanguages: ["en"]
  property string transcriptionModel: "avalon-v1.1"
  property string streamingMode: "never"
  property bool privacyMode: false
  property bool memory: false
  property bool skipLlm: false
  property bool casualMessaging: false
  property int dictionaryCount: 0
  property var dictionary: []
  property int replacementCount: 0
  property bool customInstructionsConfigured: false
  property string backendVersion: ""
  property bool websocketConnected: false
  property var supportedLanguages: []
  property var replacements: []
  property string customInstructions: ""
  property string customizationSyncedAt: ""
  property int wordCount: 0
  property var history: []

  function applyState(text) {
    try {
      var state = JSON.parse(String(text || "{}"))
      setupRequired = state.setupRequired === true
      loginHandlerConflict = state.loginHandlerConflict === true
      backendVersion = String(state.version || "")
      websocketConnected = state.connected === true
      phase = String(state.phase || "offline")
      stage = String(state.stage || "")
      completion = String(state.completion || "")
      recording = state.recording === true
      processing = state.processing === true
      hotkeyReady = state.hotkeyReady === true
      hotkeyTaps = Number(state.hotkeyTaps || 0)
      hotkeyDisplay = String(state.hotkeyDisplay || "Shift+Super+F23")
      microphone = String(state.microphone || "PipeWire default")
      pasteWithShift = state.pasteWithShift === true
      tokenPresent = state.tokenPresent === true
      var account = state.account || {}
      accountEmail = String(account.email || "")
      accountName = String(account.name || "")
      accountPlan = String(account.plan || "")
      accountValidatedAt = String(account.validatedAt || "")
      latestTranscript = String(state.latestTranscript || "")
      liveText = String(state.liveText || "")
      lastError = String(state.error || "")
      processingMs = Number(state.processingMs || 0)
      lastLatencyMs = Number(state.lastLatencyMs || 0)
      lastAudioMs = Number(state.lastAudioMs || 0)
      var config = state.settings || {}
      supportedLanguages = config.supportedLanguages || []
      replacements = config.replacements || []
      customInstructions = String(config.customInstructions || "")
      customizationSyncedAt = String(config.customizationSyncedAt || "")
      language = String(config.language || "en")
      savedLanguages = Array.isArray(config.savedLanguages) ? config.savedLanguages : [language]
      transcriptionModel = String(config.transcriptionModel || "avalon-v1.1")
      streamingMode = String(config.streamingMode || "never")
      privacyMode = config.privacyMode === true
      memory = config.memory === true
      skipLlm = config.skipLlm === true
      casualMessaging = config.casualMessaging === true
      dictionaryCount = Number(config.dictionaryCount || 0)
      dictionary = Array.isArray(config.dictionary) ? config.dictionary : []
      replacementCount = Number(config.replacementCount || 0)
      customInstructionsConfigured = config.customInstructionsConfigured === true
      wordCount = Number(config.wordCount || 0)
      history = Array.isArray(state.history) ? state.history : []
      revision += 1
    } catch (error) {
      phase = "offline"
      lastError = String(error)
      revision += 1
    }
  }

  function refresh() {
    if (!probe.running) {
      probe.command = [runner, "status"]
      probe.running = true
    }
  }

  Process {
    id: probe
    stdout: StdioCollector { onStreamFinished: root.applyState(text) }
  }

  Timer {
    interval: root.recording || root.processing ? 150 : 1000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }
}
