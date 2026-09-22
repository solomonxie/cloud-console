import Foundation

enum CloudVendor: String, CaseIterable, Identifiable, Hashable {
    case aws = "AWS"
    case azure = "Azure"
    case gcp = "Google Cloud"
    case tencent = "Tencent Cloud"
    case alibaba = "Alibaba Cloud"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .aws: return "cloud.fill"
        case .azure: return "cloud.fill"
        case .gcp: return "cloud.fill"
        case .tencent: return "cloud.fill"
        case .alibaba: return "cloud.fill"
        }
    }

    enum CredentialShape {
        case keyPair(idLabel: String, secretLabel: String)
        case connectionString(label: String)
        case jsonKey(label: String)
    }

    var credentialShape: CredentialShape {
        switch self {
        case .aws, .alibaba:
            return .keyPair(idLabel: "Access key ID", secretLabel: "Secret access key")
        case .tencent:
            return .keyPair(idLabel: "SecretId", secretLabel: "SecretKey")
        case .azure:
            return .connectionString(label: "Connection string")
        case .gcp:
            return .jsonKey(label: "Service account JSON key")
        }
    }

    var credentialHelp: String {
        switch self {
        case .aws:
            return "An IAM user access key. This app only ever does what that key's own permissions allow — give it read-only, or read/write on just what you want browsable here."
        case .tencent, .alibaba:
            return "A scoped access key for this account."
        case .azure:
            return "A storage account connection string, or a scoped SAS if you'd rather it expire."
        case .gcp:
            return "A service account key, downloaded as JSON from the cloud console. Paste the whole file."
        }
    }

    var learnMoreURL: URL {
        URL(string: "https://github.com/solomonxie/cloud-console/blob/master/docs/design/uiux/add-cloud.md")!
    }

    /// Resource kinds shown in a connection's browser, in build order.
    var resourceKinds: [ResourceKind] {
        switch self {
        case .aws:
            return [.billing, .s3, .iamUsers, .iamRoles, .ec2, .lambda, .rds, .eventBridge, .cloudWatchAlarms]
        case .tencent:
            return [.billing, .cos, .camUsers, .camRoles, .cvm, .scf, .cdb, .tencentEventBridge, .monitorAlarms]
        default:
            return []
        }
    }
}

enum ResourceKind: String, Identifiable, Hashable {
    case billing = "Billing"
    case s3 = "S3 Buckets"
    case iamUsers = "IAM Users"
    case iamRoles = "IAM Roles"
    case ec2 = "EC2 Instances"
    case lambda = "Lambda Functions"
    case rds = "Databases"
    case cos = "COS Buckets"
    case camUsers = "CAM Users"
    case camRoles = "CAM Roles"
    case cvm = "CVM Instances"
    case scf = "Cloud Functions"
    case cdb = "CDB Databases"
    case eventBridge = "EventBridge"
    case cloudWatchAlarms = "CloudWatch Alarms"
    case tencentEventBridge = "EventBridge (CEB)"
    case monitorAlarms = "Cloud Monitor Alarms"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .billing: return "creditcard.fill"
        case .s3, .cos: return "archivebox.fill"
        case .iamUsers, .camUsers: return "person.fill"
        case .iamRoles, .camRoles: return "person.2.badge.key.fill"
        case .ec2, .cvm: return "server.rack"
        case .lambda, .scf: return "bolt.fill"
        case .rds, .cdb: return "cylinder.split.1x2.fill"
        case .eventBridge, .tencentEventBridge: return "arrow.triangle.branch"
        case .cloudWatchAlarms, .monitorAlarms: return "waveform.path.ecg"
        }
    }

    var isImplemented: Bool {
        switch self {
        case .eventBridge, .cloudWatchAlarms, .tencentEventBridge, .monitorAlarms: return false
        case .lambda, .rds, .scf, .cdb: return false
        default: return true
        }
    }
}

/// What's actually stored in Keychain per connection, shaped to match credentialShape.
enum StoredCredential: Codable {
    case keyPair(id: String, secret: String)
    case single(String)
}

/// Transient state while adding/testing a connection — never persisted.
enum ConnectionTestStatus {
    case testing
    case failed(String)
}

struct CloudConnection: Identifiable, Codable, Hashable {
    let id: UUID
    let vendor: CloudVendor
    var name: String
    var addedAt: Date

    init(id: UUID = UUID(), vendor: CloudVendor, name: String, addedAt: Date = Date()) {
        self.id = id
        self.vendor = vendor
        self.name = name
        self.addedAt = addedAt
    }
}

extension CloudVendor: Codable {}
