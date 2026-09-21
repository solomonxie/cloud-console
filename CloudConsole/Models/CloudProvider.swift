import Foundation

enum CloudProvider: String, CaseIterable, Identifiable {
    case aws = "AWS"
    case azure = "Azure"
    case gcp = "Google Cloud"

    var id: String { rawValue }
}

struct GitHubRepoLink: Identifiable {
    let id = UUID()
    let fullName: String
}
