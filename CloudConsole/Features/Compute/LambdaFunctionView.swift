import SwiftUI

/// Details and a run panel: input → live CloudWatch log of that run → response.
struct LambdaFunctionDetailView: View {
    let function: LambdaFunctionSummary
    let region: String
    let credential: AWSSigV4Signer.Credential

    @State private var input: String
    @State private var isRunning = false
    @State private var confirmingRun = false
    @State private var result: LambdaInvocation?
    @State private var errorMessage: String?
    @State private var liveLog: [LogEvent] = []
    @State private var isTailing = false
    @FocusState private var inputFocused: Bool

    /// CloudWatch lags a few seconds behind the invoke's return.
    private static let logGrace: TimeInterval = 20

    init(function: LambdaFunctionSummary, region: String, credential: AWSSigV4Signer.Credential) {
        self.function = function
        self.region = region
        self.credential = credential
        _input = State(initialValue: UserDefaults.standard.string(forKey: Self.inputKey(function.name, region: region)) ?? "{}")
    }

    private static func inputKey(_ name: String, region: String) -> String { "lambda.input.\(region)/\(name)" }

    private var inputJSON: Data? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let data = Data((trimmed.isEmpty ? "{}" : trimmed).utf8)
        return (try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)) != nil ? data : nil
    }

    var body: some View {
        List {
            Section("Details") {
                ForEach(function.detailFields + [DetailField(label: "Region", value: region)], id: \.label) { field in
                    DetailRow(field: field, alwaysWrap: field.label == "Function")
                }
            }

            Section {
                TextEditor(text: $input)
                    .font(.system(.footnote, design: .monospaced))
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .frame(minHeight: 120)
                    .focused($inputFocused)
                Button {
                    inputFocused = false
                    confirmingRun = true
                } label: {
                    HStack {
                        Label(isRunning ? "Running…" : "Run", systemImage: "play.fill")
                        Spacer()
                        if isRunning { ProgressView() }
                    }
                }
                .disabled(isRunning || inputJSON == nil)
            } header: {
                Text("Input (JSON event)")
            } footer: {
                if inputJSON == nil { Text("Not valid JSON.").foregroundStyle(.red) }
            }

            if isRunning || isTailing || result != nil {
                Section("Logs") {
                    LiveLogBox(events: liveLog, fallback: result?.log, isTailing: isTailing)
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                }
            }

            if let errorMessage {
                Section("Result") {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }

            if let result {
                Section("Response") {
                    Label(result.status, systemImage: result.isError ? "xmark.octagon.fill" : "checkmark.circle.fill")
                        .foregroundStyle(result.isError ? .red : .green)
                    CodeBlock(text: prettyJSON(result.response))
                }
            }
        }
        .navigationTitle(function.name)
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { inputFocused = false }
                    .fontWeight(.semibold)
            }
        }
        .confirmationDialog("Run \(function.name)?", isPresented: $confirmingRun, titleVisibility: .visible) {
            Button("Run") { Task { await run() } }
        } message: {
            Text("This executes the function for real, with whatever side effects it has.")
        }
    }

    private func run() async {
        guard let payload = inputJSON else { return }
        UserDefaults.standard.set(input, forKey: Self.inputKey(function.name, region: region))
        isRunning = true
        errorMessage = nil
        result = nil
        liveLog = []
        let started = Date()
        // Never look past the function's own max runtime.
        let latest = started.addingTimeInterval(TimeInterval(function.timeout ?? 900) + Self.logGrace)
        let tail = Task { await tailLogs(from: started.addingTimeInterval(-2), latest: latest) }
        do {
            result = try await LambdaClient.invoke(name: function.name, payload: payload, region: region, credential: credential)
        } catch {
            errorMessage = error.localizedDescription
            tail.cancel()
        }
        isRunning = false
        await tail.value
    }

    /// Polls this run's log window until its REPORT line shows up, or the grace period after
    /// the invoke returns runs out.
    private func tailLogs(from: Date, latest: Date) async {
        if AppData.isDemo { return }
        isTailing = true
        defer { isTailing = false }
        var finishedAt: Date?
        while !Task.isCancelled, Date() < latest {
            if let events = try? await CloudWatchLogsClient.events(
                logGroup: CloudWatchLogsClient.lambdaLogGroup(function.name), from: from, to: latest, region: region, credential: credential
            ) {
                liveLog = events
            }
            if let result {
                // The invoke's own log tail is complete when it still has the START line.
                if let id = result.requestID, result.log?.contains("START RequestId: \(id)") == true { return }
                if let id = result.requestID, liveLog.contains(where: { $0.message.contains("REPORT RequestId: \(id)") }) { return }
                finishedAt = finishedAt ?? Date()
                if Date().timeIntervalSince(finishedAt!) > Self.logGrace { return }
            }
            try? await Task.sleep(for: .seconds(2))
        }
    }
}

/// Fixed-height, read-only log pane that follows the newest line; partial text is selectable.
private struct LiveLogBox: View {
    let events: [LogEvent]
    let fallback: String?
    let isTailing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if events.isEmpty && (fallback ?? "").isEmpty && !isTailing {
                Text("No log output.").font(.footnote).foregroundStyle(.secondary)
            } else {
                LogTextView(text: logText)
                    .frame(height: 260)
            }
            if isTailing {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Waiting for logs…").font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }

    private static let timeFormat: Date.FormatStyle = .dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).second(.twoDigits)

    private var logText: NSAttributedString {
        let mono = UIFont.monospacedSystemFont(ofSize: UIFont.preferredFont(forTextStyle: .caption1).pointSize, weight: .regular)
        let out = NSMutableAttributedString()
        guard !events.isEmpty else {
            out.append(NSAttributedString(string: fallback ?? "", attributes: [.font: mono, .foregroundColor: UIColor.label]))
            return out
        }
        for (index, event) in events.enumerated() {
            if index > 0 { out.append(NSAttributedString(string: "\n")) }
            out.append(NSAttributedString(string: event.timestamp.formatted(Self.timeFormat) + "  ", attributes: [.font: mono, .foregroundColor: UIColor.secondaryLabel]))
            out.append(NSAttributedString(string: event.message, attributes: [.font: mono, .foregroundColor: Self.isError(event.message) ? UIColor.systemRed : UIColor.label]))
        }
        return out
    }

    private static func isError(_ message: String) -> Bool {
        message.contains("ERROR") || message.contains("Task timed out") || message.contains("Traceback")
    }
}

private struct LogTextView: UIViewRepresentable {
    let text: NSAttributedString

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        guard view.attributedText != text else { return }
        view.attributedText = text
        view.layoutIfNeeded()
        view.scrollRangeToVisible(NSRange(location: max(text.length - 1, 0), length: 1))
    }
}

private struct CodeBlock: View {
    let text: String

    var body: some View {
        ScrollView(.horizontal) {
            Text(text)
                .font(.system(.caption, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .contextMenu {
            Button { UIPasteboard.general.string = text } label: { Label("Copy", systemImage: "doc.on.doc") }
        }
    }
}

private func prettyJSON(_ text: String) -> String {
    guard let object = try? JSONSerialization.jsonObject(with: Data(text.utf8), options: .fragmentsAllowed),
          let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed]) else { return text }
    return String(decoding: data, as: UTF8.self)
}
