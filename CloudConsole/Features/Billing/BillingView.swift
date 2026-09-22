import SwiftUI

@MainActor
final class BillingStore: ObservableObject {
    @Published var cost: MonthToDateCost?
    @Published var isLoading = true
    @Published var errorMessage: String?

    private let fetchCost: () async throws -> MonthToDateCost
    private let cacheKey: String

    init(cacheKey: String, load: @escaping () async throws -> MonthToDateCost) {
        self.cacheKey = cacheKey
        self.fetchCost = load
    }

    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            cost = try await cached(key: cacheKey, ttl: defaultResourceTTL, forceRefresh: forceRefresh, fetch: fetchCost)
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

    /// Past months are closed books — their totals don't change, so once fetched they're
    /// cached indefinitely (pull-to-refresh still forces a refetch if you ever want one).
    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            bills = try await cached(key: cacheKey, ttl: .infinity, forceRefresh: forceRefresh, fetch: fetchHistory)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

struct BillingView: View {
    @StateObject private var store: BillingStore
    @StateObject private var history: BillingHistoryStore

    init(cacheKey: String, load: @escaping () async throws -> MonthToDateCost, loadHistory: @escaping () async throws -> [MonthToDateCost]) {
        _store = StateObject(wrappedValue: BillingStore(cacheKey: "billing-mtd:\(cacheKey)", load: load))
        _history = StateObject(wrappedValue: BillingHistoryStore(cacheKey: "billing-history:\(cacheKey)", load: loadHistory))
    }

    var body: some View {
        Group {
            if store.isLoading && store.cost == nil {
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
            } else if let cost = store.cost {
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
                                HStack {
                                    Text(item.serviceName).lineLimit(1)
                                    Spacer()
                                    Text(item.amount, format: .currency(code: cost.unit))
                                        .foregroundStyle(.secondary)
                                }
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
                                BillingHistoryRow(bill: bill)
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
        .task {
            if store.cost == nil { await store.load(forceRefresh: false) }
            if history.bills.isEmpty { await history.load(forceRefresh: false) }
        }
    }
}

/// One month's bill — expands in place to show its cost-by-service breakdown, rather than
/// pushing a new page.
private struct BillingHistoryRow: View {
    let bill: MonthToDateCost

    var body: some View {
        DisclosureGroup {
            if bill.byService.isEmpty {
                Text("No costs recorded.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(bill.byService) { item in
                    HStack {
                        Text(item.serviceName).lineLimit(1)
                        Spacer()
                        Text(item.amount, format: .currency(code: bill.unit))
                            .foregroundStyle(.secondary)
                    }
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
    return date.formatted(.dateTime.month(.wide).year())
}
