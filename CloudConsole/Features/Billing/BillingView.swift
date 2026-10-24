import SwiftUI

/// Cost Explorer charges per request and refreshes a few times a day, so drill-downs keep longer.
let costDetailTTL: TimeInterval = 3600

typealias ServiceDetailLoader = (ServiceCost, MonthToDateCost) async throws -> ServiceCostDetail

@MainActor
final class CachedValueStore<Value: Codable>: ObservableObject {
    @Published var value: Value?
    @Published var isLoading = true
    @Published var errorMessage: String?

    private let fetch: () async throws -> Value
    private let cacheKey: String
    private let ttl: TimeInterval

    init(cacheKey: String, ttl: TimeInterval = defaultResourceTTL, load: @escaping () async throws -> Value) {
        self.cacheKey = cacheKey
        self.ttl = ttl
        self.fetch = load
    }

    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            value = try await cached(key: cacheKey, ttl: ttl, forceRefresh: forceRefresh, fetch: fetch)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

@MainActor
final class BillingHistoryStore: ObservableObject {
    @Published var bills: [MonthToDateCost] = []
    @Published var isLoading = true
    @Published var errorMessage: String?

    private let fetchHistory: () async throws -> [MonthToDateCost]
    private let cacheKey: String

    init(cacheKey: String, load: @escaping () async throws -> [MonthToDateCost]) {
        self.cacheKey = cacheKey
        self.fetchHistory = load
    }

    /// The range includes the in-progress month and late charges land after a month closes,
    /// so entries expire on the normal TTL; the month in the key drops stale pre-rollover data.
    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            let month = Date().formatted(.iso8601.year().month())
            bills = try await cached(key: "\(cacheKey):\(month)", ttl: defaultResourceTTL, forceRefresh: forceRefresh, fetch: fetchHistory)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

struct BillingView: View {
    @StateObject private var store: CachedValueStore<MonthToDateCost>
    @StateObject private var history: BillingHistoryStore
    private let connectionName: String
    private let cacheKey: String
    private let loadDetail: ServiceDetailLoader

    init(connectionName: String, cacheKey: String, load: @escaping () async throws -> MonthToDateCost, loadHistory: @escaping () async throws -> [MonthToDateCost], loadDetail: @escaping ServiceDetailLoader) {
        _store = StateObject(wrappedValue: CachedValueStore(cacheKey: "billing-mtd:\(cacheKey)", load: load))
        _history = StateObject(wrappedValue: BillingHistoryStore(cacheKey: "billing-history:\(cacheKey)", load: loadHistory))
        self.connectionName = connectionName
        self.cacheKey = cacheKey
        self.loadDetail = loadDetail
    }

    var body: some View {
        Group {
            if store.isLoading && store.value == nil {
                ProgressView("Loading costs…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage = store.errorMessage {
                ContentUnavailableView {
                    Label("Couldn't load billing", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await store.load(forceRefresh: true) } }
                }
            } else if let cost = store.value {
                List {
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(cost.total, format: .currency(code: cost.unit))
                                .font(.system(size: 40, weight: .bold, design: .rounded))
                            Text("Month to date\(cost.isEstimated ? " · estimated" : "")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 8)
                    }
                    if let balance = cost.balance {
                        Section("Balance") {
                            HStack {
                                Text("Remaining")
                                Spacer()
                                Text(balance, format: .currency(code: cost.unit))
                                    .foregroundStyle(balance < 0 ? .red : .primary)
                            }
                        }
                    }
                    if cost.byService.isEmpty {
                        Section {
                            Text("No costs recorded yet this month.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Section("By service") {
                            ForEach(cost.byService) { item in
                                serviceLink(item, bill: cost)
                            }
                        }
                    }
                    Section("History") {
                        if history.isLoading && history.bills.isEmpty {
                            ProgressView()
                        } else if let errorMessage = history.errorMessage {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(errorMessage).font(.caption).foregroundStyle(.secondary)
                                Button("Retry") { Task { await history.load(forceRefresh: true) } }.font(.caption)
                            }
                        } else if history.bills.isEmpty {
                            Text("No history yet.").font(.caption).foregroundStyle(.secondary)
                        } else {
                            ForEach(history.bills) { bill in
                                BillingHistoryRow(bill: bill) { serviceLink($0, bill: bill) }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable {
                    await store.load(forceRefresh: true)
                    await history.load(forceRefresh: true)
                }
            }
        }
        .navigationTitle("Billing")
        .connectionSubtitle(connectionName)
        .task {
            if store.value == nil { await store.load(forceRefresh: false) }
            if history.bills.isEmpty { await history.load(forceRefresh: false) }
        }
    }

    private func serviceLink(_ item: ServiceCost, bill: MonthToDateCost) -> some View {
        NavigationLink {
            ServiceCostDetailView(
                service: item, bill: bill, connectionName: connectionName,
                cacheKey: "billing-detail@\(item.serviceName):\(cacheKey):\(bill.periodStart)",
                load: { [loadDetail] in try await loadDetail(item, bill) }
            )
        } label: {
            ServiceCostRow(name: item.displayName, amount: item.amount, unit: bill.unit)
        }
    }
}

private struct ServiceCostRow: View {
    let name: String
    let amount: Double
    let unit: String

    var body: some View {
        HStack {
            Text(name).lineLimit(1)
            Spacer()
            Text(amount, format: .currency(code: unit))
                .foregroundStyle(.secondary)
        }
    }
}

private extension View {
    /// Gray connection name beside the title; older iOS has no nav subtitle, so shows none.
    @ViewBuilder
    func connectionSubtitle(_ name: String) -> some View {
        if #available(iOS 26, *) {
            navigationSubtitle(name)
        } else {
            self
        }
    }
}

/// One service's bill for one period: by usage category, then by resource with each
/// resource's own category split.
private struct ServiceCostDetailView: View {
    let service: ServiceCost
    let bill: MonthToDateCost
    let connectionName: String
    @StateObject private var store: CachedValueStore<ServiceCostDetail>

    init(service: ServiceCost, bill: MonthToDateCost, connectionName: String, cacheKey: String, load: @escaping () async throws -> ServiceCostDetail) {
        self.service = service
        self.bill = bill
        self.connectionName = connectionName
        _store = StateObject(wrappedValue: CachedValueStore(cacheKey: cacheKey, ttl: costDetailTTL, load: load))
    }

    var body: some View {
        Group {
            if store.isLoading && store.value == nil {
                ProgressView("Loading \(service.displayName) costs…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage = store.errorMessage {
                ContentUnavailableView {
                    Label("Couldn't load \(service.displayName) costs", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await store.load(forceRefresh: true) } }
                }
            } else if let detail = store.value {
                List {
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(detail.total, format: .currency(code: detail.unit))
                                .font(.system(size: 40, weight: .bold, design: .rounded))
                            Text("\(service.serviceName) · \(monthLabel(bill.periodStart))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 8)
                    }
                    Section("By usage") {
                        if detail.usage.isEmpty {
                            Text("No usage recorded.").font(.caption).foregroundStyle(.secondary)
                        }
                        ForEach(detail.usage) { usage in
                            ServiceCostRow(name: usage.name, amount: usage.amount, unit: detail.unit)
                        }
                    }
                    Section {
                        if detail.resources.isEmpty && detail.resourcesNote == nil {
                            Text("No per-resource costs recorded.").font(.caption).foregroundStyle(.secondary)
                        }
                        ForEach(detail.resources) { resource in
                            DisclosureGroup {
                                ForEach(resource.usage) { usage in
                                    ServiceCostRow(name: usage.name, amount: usage.amount, unit: detail.unit)
                                        .font(.subheadline)
                                }
                            } label: {
                                ServiceCostRow(name: resourceLabel(resource.resourceID), amount: resource.amount, unit: detail.unit)
                            }
                        }
                    } header: {
                        Text(resourceHeader)
                    } footer: {
                        resourceFooter(detail)
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await store.load(forceRefresh: true) }
            }
        }
        .navigationTitle(service.displayName)
        .connectionSubtitle(connectionName)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if store.value == nil { await store.load(forceRefresh: false) }
        }
    }

    private var resourceHeader: String {
        switch service.displayName {
        case "S3", "COS": "By bucket"
        case "Lambda", "SCF": "By function"
        case "EC2", "CVM": "By instance"
        case "RDS", "MySQL": "By database"
        default: "By resource"
        }
    }

    /// ARNs shortened to their last segment (a function or instance name).
    private func resourceLabel(_ id: String) -> String {
        guard !id.isEmpty, id != "NoResourceId" else { return "Not tied to a resource" }
        guard id.hasPrefix("arn:") else { return id }
        return id.split(whereSeparator: { $0 == ":" || $0 == "/" }).last.map(String.init) ?? id
    }

    @ViewBuilder
    private func resourceFooter(_ detail: ServiceCostDetail) -> some View {
        let window = detail.resourcesFrom.flatMap { from in detail.resourcesTo.map { (from, $0) } }
        let lines = [
            window.map { "\(dayLabel($0.0)) – \(dayLabel($0.1))" + ($0.0 > bill.periodStart ? " (last 14 days kept by AWS)" : "") },
            detail.resourcesNote,
        ].compactMap { $0 }
        if !lines.isEmpty { Text(lines.joined(separator: "\n")) }
    }
}

/// One month's bill — expands in place to show its cost-by-service breakdown; each service
/// drills into its own page.
private struct BillingHistoryRow<ServiceLink: View>: View {
    let bill: MonthToDateCost
    @ViewBuilder let serviceLink: (ServiceCost) -> ServiceLink

    var body: some View {
        DisclosureGroup {
            if bill.byService.isEmpty {
                Text("No costs recorded.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(bill.byService) { item in
                    serviceLink(item)
                }
            }
        } label: {
            HStack {
                Text(monthLabel(bill.periodStart))
                Spacer()
                Text(bill.total, format: .currency(code: bill.unit))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private func monthLabel(_ periodStart: String) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.locale = Locale(identifier: "en_US_POSIX")
    guard let date = formatter.date(from: periodStart) else { return periodStart }
    return date.formatted(Date.FormatStyle(timeZone: TimeZone(identifier: "UTC")!).month(.wide).year())
}

private func dayLabel(_ ymd: String) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.locale = Locale(identifier: "en_US_POSIX")
    guard let date = formatter.date(from: ymd) else { return ymd }
    return date.formatted(Date.FormatStyle(timeZone: TimeZone(identifier: "UTC")!).month(.abbreviated).day())
}
