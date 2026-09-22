import SwiftUI

@MainActor
final class TencentCAMUsersStore: ObservableObject, ExpandableResourceStore {
    @Published var items: [IAMUser] = []
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var visibleCount = 20

    private let credential: AWSSigV4Signer.Credential
    private let cacheKey: String

    init(credential: AWSSigV4Signer.Credential) {
        self.credential = credential
        self.cacheKey = "cam-users:\(credential.accessKeyID)"
    }

    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            items = try await cached(key: cacheKey, ttl: defaultResourceTTL, forceRefresh: forceRefresh) {
                try await TencentCAMClient.listUsers(credential: credential).sorted { $0.userName < $1.userName }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

@MainActor
final class TencentCAMRolesStore: ObservableObject, ExpandableResourceStore {
    @Published var items: [IAMRole] = []
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var visibleCount = 20

    private let credential: AWSSigV4Signer.Credential
    private let cacheKey: String

    init(credential: AWSSigV4Signer.Credential) {
        self.credential = credential
        self.cacheKey = "cam-roles:\(credential.accessKeyID)"
    }

    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            items = try await cached(key: cacheKey, ttl: defaultResourceTTL, forceRefresh: forceRefresh) {
                try await TencentCAMClient.listRoles(credential: credential).sorted { $0.roleName < $1.roleName }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

@MainActor
private final class AttachedPolicyNamesStore: ObservableObject {
    @Published var names: [String] = []
    @Published var isLoading = true
    @Published var errorMessage: String?

    private let fetch: () async throws -> [String]

    init(fetch: @escaping () async throws -> [String]) {
        self.fetch = fetch
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            names = try await fetch()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

/// CAM's user detail — simpler than the AWS IAM version: just attached policy names, no
/// document fetching (Tencent's policy-document API surface is the least-verified part here).
struct TencentCAMUserDetailView: View {
    let user: IAMUser
    let credential: AWSSigV4Signer.Credential
    @StateObject private var policies: AttachedPolicyNamesStore

    init(user: IAMUser, credential: AWSSigV4Signer.Credential) {
        self.user = user
        self.credential = credential
        _policies = StateObject(wrappedValue: AttachedPolicyNamesStore {
            try await TencentCAMClient.listAttachedUserPolicyNames(userArn: user.arn, credential: credential)
        })
    }

    var body: some View {
        List {
            Section("Details") {
                LabeledContent("Name", value: user.userName)
                LabeledContent("Uin", value: user.arn)
                if let date = user.createDate {
                    LabeledContent("Created", value: date.formatted(date: .abbreviated, time: .omitted))
                }
            }
            Section("Attached policies") {
                if policies.isLoading && policies.names.isEmpty {
                    ProgressView()
                } else if let errorMessage = policies.errorMessage {
                    Text(errorMessage).font(.caption).foregroundStyle(.secondary)
                } else if policies.names.isEmpty {
                    Text("No attached policies").font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(policies.names, id: \.self) { Text($0) }
                }
            }
        }
        .navigationTitle(user.userName)
        .task { await policies.load() }
    }
}

struct TencentCAMRoleDetailView: View {
    let role: IAMRole
    let credential: AWSSigV4Signer.Credential
    @StateObject private var policies: AttachedPolicyNamesStore

    init(role: IAMRole, credential: AWSSigV4Signer.Credential) {
        self.role = role
        self.credential = credential
        _policies = StateObject(wrappedValue: AttachedPolicyNamesStore {
            try await TencentCAMClient.listAttachedRolePolicyNames(roleArn: role.arn, credential: credential)
        })
    }

    var body: some View {
        List {
            Section("Details") {
                LabeledContent("Name", value: role.roleName)
                LabeledContent("Role ID", value: role.arn)
                if let date = role.createDate {
                    LabeledContent("Created", value: date.formatted(date: .abbreviated, time: .omitted))
                }
            }
            Section("Attached policies") {
                if policies.isLoading && policies.names.isEmpty {
                    ProgressView()
                } else if let errorMessage = policies.errorMessage {
                    Text(errorMessage).font(.caption).foregroundStyle(.secondary)
                } else if policies.names.isEmpty {
                    Text("No attached policies").font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(policies.names, id: \.self) { Text($0) }
                }
            }
        }
        .navigationTitle(role.roleName)
        .task { await policies.load() }
    }
}
