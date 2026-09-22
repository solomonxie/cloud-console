import SwiftUI

@MainActor
final class IAMUsersStore: ObservableObject, ExpandableResourceStore {
    @Published var items: [IAMUser] = []
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var visibleCount = 20

    private let credential: AWSSigV4Signer.Credential
    private let cacheKey: String

    init(credential: AWSSigV4Signer.Credential) {
        self.credential = credential
        self.cacheKey = "iam-users:\(credential.accessKeyID)"
    }

    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            items = try await cached(key: cacheKey, ttl: defaultResourceTTL, forceRefresh: forceRefresh) {
                try await IAMClient.listUsers(credential: credential).sorted { $0.userName < $1.userName }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

@MainActor
final class IAMRolesStore: ObservableObject, ExpandableResourceStore {
    @Published var items: [IAMRole] = []
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var visibleCount = 20

    private let credential: AWSSigV4Signer.Credential
    private let cacheKey: String

    init(credential: AWSSigV4Signer.Credential) {
        self.credential = credential
        self.cacheKey = "iam-roles:\(credential.accessKeyID)"
    }

    /// Excludes AWS-managed service-linked/reserved roles — noise the account owner never created.
    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            items = try await cached(key: cacheKey, ttl: defaultResourceTTL, forceRefresh: forceRefresh) {
                let roles = try await IAMClient.listRoles(credential: credential)
                return roles.filter { !$0.isServiceManaged }.sorted { $0.roleName < $1.roleName }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

struct IAMUserRow: View {
    let user: IAMUser
    let connection: CloudConnection

    var body: some View {
        HStack(spacing: 12) {
            VendorBadge(systemImage: "person.fill", color: connection.vendor.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(user.userName).lineLimit(1)
                Text(user.arn)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .padding(.vertical, 2)
    }
}

struct IAMRoleRow: View {
    let role: IAMRole
    let connection: CloudConnection

    var body: some View {
        HStack(spacing: 12) {
            VendorBadge(systemImage: "person.2.badge.key.fill", color: connection.vendor.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(role.roleName).lineLimit(1)
                Text(role.arn)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .padding(.vertical, 2)
    }
}

@MainActor
final class IAMPoliciesStore: ObservableObject {
    @Published var attachedPolicies: [IAMPolicyAttachment] = []
    @Published var inlinePolicyNames: [String] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let load: () async throws -> ([IAMPolicyAttachment], [String])

    init(load: @escaping () async throws -> ([IAMPolicyAttachment], [String])) {
        self.load = load
    }

    func loadPolicies() async {
        isLoading = true
        errorMessage = nil
        do {
            (attachedPolicies, inlinePolicyNames) = try await load()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

struct IAMUserDetailView: View {
    let user: IAMUser
    let credential: AWSSigV4Signer.Credential
    @StateObject private var policies: IAMPoliciesStore

    init(user: IAMUser, credential: AWSSigV4Signer.Credential) {
        self.user = user
        self.credential = credential
        _policies = StateObject(wrappedValue: IAMPoliciesStore {
            async let attached = IAMClient.listAttachedUserPolicies(userName: user.userName, credential: credential)
            async let inline = IAMClient.listUserPolicyNames(userName: user.userName, credential: credential)
            return (try await attached, try await inline)
        })
    }

    var body: some View {
        List {
            Section("Details") {
                LabeledContent("User name", value: user.userName)
                LabeledContent("ARN", value: user.arn)
                    .lineLimit(1)
                    .truncationMode(.middle)
                LabeledContent("Path", value: user.path)
                if let date = user.createDate {
                    LabeledContent("Created", value: date.formatted(date: .abbreviated, time: .omitted))
                }
            }
            PolicySections(
                store: policies,
                loadAttachedDocument: { policy in try await IAMClient.attachedPolicyDocument(policyArn: policy.policyArn, credential: credential) },
                loadInlineDocument: { name in try await IAMClient.inlineUserPolicyDocument(userName: user.userName, policyName: name, credential: credential) }
            )
        }
        .navigationTitle(user.userName)
        .task { await policies.loadPolicies() }
    }
}

struct IAMRoleDetailView: View {
    let role: IAMRole
    let credential: AWSSigV4Signer.Credential
    @StateObject private var policies: IAMPoliciesStore

    init(role: IAMRole, credential: AWSSigV4Signer.Credential) {
        self.role = role
        self.credential = credential
        _policies = StateObject(wrappedValue: IAMPoliciesStore {
            async let attached = IAMClient.listAttachedRolePolicies(roleName: role.roleName, credential: credential)
            async let inline = IAMClient.listRolePolicyNames(roleName: role.roleName, credential: credential)
            return (try await attached, try await inline)
        })
    }

    var body: some View {
        List {
            Section("Details") {
                LabeledContent("Role name", value: role.roleName)
                LabeledContent("ARN", value: role.arn)
                    .lineLimit(1)
                    .truncationMode(.middle)
                LabeledContent("Path", value: role.path)
                if let date = role.createDate {
                    LabeledContent("Created", value: date.formatted(date: .abbreviated, time: .omitted))
                }
            }
            PolicySections(
                store: policies,
                loadAttachedDocument: { policy in try await IAMClient.attachedPolicyDocument(policyArn: policy.policyArn, credential: credential) },
                loadInlineDocument: { name in try await IAMClient.inlineRolePolicyDocument(roleName: role.roleName, policyName: name, credential: credential) }
            )
        }
        .navigationTitle(role.roleName)
        .task { await policies.loadPolicies() }
    }
}

private struct PolicySections: View {
    @ObservedObject var store: IAMPoliciesStore
    let loadAttachedDocument: (IAMPolicyAttachment) async throws -> String
    let loadInlineDocument: (String) async throws -> String

    var body: some View {
        Section("Attached policies") {
            if store.isLoading && store.attachedPolicies.isEmpty && store.errorMessage == nil {
                ProgressView()
            } else if let errorMessage = store.errorMessage {
                Text(errorMessage).font(.caption).foregroundStyle(.secondary)
            } else if store.attachedPolicies.isEmpty {
                Text("No attached policies").font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(store.attachedPolicies) { policy in
                    PolicyDisclosureRow(title: policy.policyName, subtitle: policy.policyArn) {
                        try await loadAttachedDocument(policy)
                    }
                }
            }
        }
        if !store.isLoading || !store.inlinePolicyNames.isEmpty {
            Section("Inline policies") {
                if store.inlinePolicyNames.isEmpty {
                    Text("No inline policies").font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(store.inlinePolicyNames, id: \.self) { name in
                        PolicyDisclosureRow(title: name, subtitle: nil) {
                            try await loadInlineDocument(name)
                        }
                    }
                }
            }
        }
    }
}

/// A policy row that stays collapsed until tapped, then fetches and shows its JSON
/// document — avoids firing a GetPolicy/GetPolicyVersion round trip per policy up front.
private struct PolicyDisclosureRow: View {
    let title: String
    let subtitle: String?
    let loadDocument: () async throws -> String

    @State private var expanded = false
    @State private var document: String?
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            if isLoading {
                ProgressView().padding(.vertical, 4)
            } else if let errorMessage {
                Text(errorMessage).font(.caption).foregroundStyle(.secondary)
            } else if let document {
                ScrollView(.horizontal, showsIndicators: true) {
                    Text(document)
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                        .padding(.vertical, 4)
                }
            }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
        .onChange(of: expanded) { _, isExpanded in
            guard isExpanded, document == nil, !isLoading else { return }
            isLoading = true
            Task {
                do {
                    document = Self.prettyPrinted(try await loadDocument())
                } catch {
                    errorMessage = error.localizedDescription
                }
                isLoading = false
            }
        }
    }

    private static func prettyPrinted(_ raw: String) -> String {
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let pretty = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]) else {
            return raw
        }
        return String(data: pretty, encoding: .utf8) ?? raw
    }
}
