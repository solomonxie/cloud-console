import Foundation

enum CloudVendor: String, CaseIterable, Identifiable {
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
        case .aws, .tencent, .alibaba:
            return .keyPair(idLabel: "Access key ID", secretLabel: "Secret access key")
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
            return [.s3, .ec2, .lambda, .rds]
        default:
            return []
        }
    }
}

enum ResourceKind: String, Identifiable {
    case s3 = "S3 Buckets"
    case ec2 = "EC2 Instances"
    case lambda = "Lambda Functions"
    case rds = "Databases"

    var id: String { rawValue }

    var shortLabel: String {
        switch self {
        case .s3: return "S3"
        case .ec2: return "EC2"
        case .lambda: return "Lambda"
        case .rds: return "RDS"
        }
    }

    var icon: String {
        switch self {
        case .s3: return "archivebox.fill"
        case .ec2: return "server.rack"
        case .lambda: return "bolt.fill"
        case .rds: return "cylinder.split.1x2.fill"
        }
    }

    var isImplemented: Bool {
        self == .s3
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

struct CloudConnection: Identifiable, Codable {
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
