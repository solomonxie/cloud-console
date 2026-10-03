import SwiftUI
import Charts

/// One health tile's metric: how to fetch it and how to show its value.
private struct HealthMetric: Identifiable {
    enum Unit { case percent, bytesPerSecond }
    let id: String
    let title: String
    let unit: Unit
    let query: MetricQuery
    var needsAgent = false
}

@MainActor
final class EC2HealthStore: ObservableObject {
    @Published var checks: EC2StatusChecks?
    @Published var series: [String: [MetricPoint]] = [:]
    @Published var updatedAt: Date?
    @Published var errorMessage: String?

    static let window: TimeInterval = 3 * 3600
    static let period = 300

    fileprivate let metrics: [HealthMetric]
    private let instanceId: String
    private let region: String
    private let credential: AWSSigV4Signer.Credential

    init(instanceId: String, region: String, credential: AWSSigV4Signer.Credential) {
        self.instanceId = instanceId
        self.region = region
        self.credential = credential
        let dims = ["InstanceId": instanceId]
        func ec2(_ id: String, _ title: String, _ name: String, _ unit: HealthMetric.Unit, stat: String = "Average") -> HealthMetric {
            HealthMetric(id: id, title: title, unit: unit, query: MetricQuery(id: id, namespace: "AWS/EC2", name: name, dimensions: dims, stat: stat))
        }
        func agent(_ id: String, _ title: String, _ name: String, extra: String = "") -> HealthMetric {
            let search = #"Namespace="CWAgent" MetricName="\#(name)" InstanceId="\#(instanceId)"\#(extra)"#
            return HealthMetric(id: id, title: title, unit: .percent, query: MetricQuery(id: id, namespace: "CWAgent", name: name, dimensions: dims, search: search), needsAgent: true)
        }
        metrics = [
            ec2("cpu", "CPU", "CPUUtilization", .percent),
            agent("mem", "Memory", "mem_used_percent"),
            agent("disk", "Disk used (/)", "disk_used_percent", extra: #" path="/""#),
            ec2("netIn", "Network in", "NetworkIn", .bytesPerSecond, stat: "Sum"),
            ec2("netOut", "Network out", "NetworkOut", .bytesPerSecond, stat: "Sum"),
            ec2("diskRead", "Disk read", "EBSReadBytes", .bytesPerSecond, stat: "Sum"),
            ec2("diskWrite", "Disk write", "EBSWriteBytes", .bytesPerSecond, stat: "Sum"),
        ]
    }

    func load() async {
        let now = Date()
        async let checks = EC2Client.statusChecks(instanceId: instanceId, region: region, credential: credential)
        async let series = CloudWatchMetricsClient.series(metrics.map(\.query), from: now.addingTimeInterval(-Self.window), to: now, period: Self.period, region: region, credential: credential)
        do {
            let (c, s) = try await (checks, series)
            self.checks = c
            // Sums per period → bytes per second.
            self.series = s.reduce(into: [:]) { out, pair in
                let perSecond = metrics.first { $0.id == pair.key }?.unit == .bytesPerSecond
                out[pair.key] = perSecond ? pair.value.map { MetricPoint(time: $0.time, value: $0.value / Double(Self.period)) } : pair.value
            }
            updatedAt = now
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct EC2InstanceDetailView: View {
    let instance: EC2Instance
    let region: String
    @StateObject private var health: EC2HealthStore

    init(instance: EC2Instance, region: String, credential: AWSSigV4Signer.Credential) {
        self.instance = instance
        self.region = region
        _health = StateObject(wrappedValue: EC2HealthStore(instanceId: instance.instanceId, region: region, credential: credential))
    }

    var body: some View {
        List {
            Section("Details") {
                ForEach(instance.detailFields + [DetailField(label: "Region", value: region)], id: \.label) {
                    DetailRow(field: $0)
                }
            }

            Section("Status checks") {
                StatusRow(title: "System", status: health.checks?.system)
                StatusRow(title: "Instance", status: health.checks?.instance)
                StatusRow(title: "Attached EBS", status: health.checks?.ebs)
            }

            Section {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                    ForEach(health.metrics) { metric in
                        HealthTile(metric: metric, points: health.series[metric.id] ?? [])
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
                #if SCREENSHOTS
                .id(Screenshots.endID)
                #endif
            } header: {
                Text("Health · last 3 h")
            } footer: {
                VStack(alignment: .leading, spacing: 4) {
                    if let error = health.errorMessage {
                        Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                    }
                    if instance.state != "running" {
                        Text("Instance is \(instance.state) — no new data points.")
                    }
                    Text("CloudWatch reports every 5 min (1 min with detailed monitoring). Refreshes every minute\(health.updatedAt.map { "; updated \($0.formatted(date: .omitted, time: .shortened))" } ?? "").")
                }
            }
        }
        .navigationTitle(instance.name?.isEmpty == false ? instance.name! : instance.instanceId)
        #if SCREENSHOTS
        .modifier(Screenshots.ScrollToEnd(active: Screenshots.is("ec2-health")))
        #endif
        .refreshable { await health.load() }
        .task {
            while !Task.isCancelled {
                await health.load()
                try? await Task.sleep(for: .seconds(60))
            }
        }
    }
}

private struct StatusRow: View {
    let title: String
    let status: String?

    var body: some View {
        LabeledContent(title) {
            Label(label, systemImage: icon)
                .foregroundStyle(color)
        }
    }

    private var label: String {
        switch status {
        case "ok": return "OK"
        case "impaired": return "Impaired"
        case "initializing": return "Initializing"
        case "insufficient-data": return "Insufficient data"
        case "not-applicable": return "N/A"
        case nil: return "—"
        default: return status!.capitalized
        }
    }

    private var icon: String {
        switch status {
        case "ok": return "checkmark.circle.fill"
        case "impaired": return "xmark.octagon.fill"
        case "initializing": return "clock.fill"
        default: return "minus.circle"
        }
    }

    private var color: Color {
        switch status {
        case "ok": return .green
        case "impaired": return .red
        case "initializing": return .orange
        default: return .secondary
        }
    }
}

/// Latest value plus a sparkline; drag across the line to read any point.
private struct HealthTile: View {
    let metric: HealthMetric
    let points: [MetricPoint]
    @State private var selected: Date?

    private var shown: MetricPoint? {
        guard let selected else { return points.last }
        return points.min { abs($0.time.timeIntervalSince(selected)) < abs($1.time.timeIntervalSince(selected)) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(metric.title)
                .font(.caption)
                .foregroundStyle(.secondary)
            if let shown {
                HStack(alignment: .firstTextBaseline) {
                    Text(format(shown.value))
                        .font(.title3.weight(.semibold).monospacedDigit())
                    Spacer()
                    if selected != nil {
                        Text(shown.time.formatted(date: .omitted, time: .shortened))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Chart(points, id: \.time) { point in
                    LineMark(x: .value("Time", point.time), y: .value(metric.title, point.value))
                        .interpolationMethod(.monotone)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                    if selected != nil, point.time == shown.time {
                        PointMark(x: .value("Time", point.time), y: .value(metric.title, point.value))
                            .symbolSize(64)
                    }
                }
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .chartYScale(domain: metric.unit == .percent ? 0...100 : 0...max(points.map(\.value).max() ?? 1, 1))
                .chartXSelection(value: $selected)
                .frame(height: 40)
            } else {
                Text(metric.needsAgent ? "Needs CloudWatch agent" : "No data")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 66, alignment: .topLeading)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(.secondarySystemGroupedBackground)))
    }

    private func format(_ value: Double) -> String {
        switch metric.unit {
        case .percent: return String(format: "%.1f%%", value)
        case .bytesPerSecond: return ByteCountFormatter.string(fromByteCount: Int64(value), countStyle: .binary) + "/s"
        }
    }
}
