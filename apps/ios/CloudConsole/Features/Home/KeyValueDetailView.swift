import SwiftUI

/// Plain field-list detail page shared by the simpler resource kinds.
struct KeyValueDetailView: View {
    let title: String
    let fields: [DetailField]

    var body: some View {
        List {
            Section("Details") {
                ForEach(fields, id: \.label) { field in
                    DetailRow(field: field)
                }
            }
        }
        .navigationTitle(title)
    }
}

/// One line, middle-truncated; tap to show the full value.
struct DetailRow: View {
    let field: DetailField
    var alwaysWrap = false
    @State private var expanded = false

    var body: some View {
        LabeledContent(field.label) {
            Text(field.value)
                .lineLimit(alwaysWrap || expanded ? nil : 1)
                .truncationMode(.middle)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .contentShape(Rectangle())
        .onTapGesture { expanded.toggle() }
    }
}
