import React from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "./ui";
import { useTheme } from "../theme";

export function PasscodeDots({ filled }: { filled: number }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 18, justifyContent: "center" }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: theme.text, backgroundColor: i < filled ? theme.text : "transparent" }} />
      ))}
    </View>
  );
}

/** Native-style 3×4 number pad. */
export function NumberPad({ onDigit, onDelete }: { onDigit: (d: string) => void; onDelete: () => void }) {
  const theme = useTheme();
  const rows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["", "0", "del"]];
  return (
    <View style={{ gap: 16, alignItems: "center" }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap: 24 }}>
          {row.map((key, k) =>
            key === "" ? (
              <View key={k} style={{ width: 76, height: 76 }} />
            ) : (
              <Pressable
                key={k}
                accessibilityLabel={key === "del" ? "Delete" : key}
                onPress={() => (key === "del" ? onDelete() : onDigit(key))}
                style={({ pressed }) => ({
                  width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center",
                  backgroundColor: key === "del" ? "transparent" : pressed ? theme.tertiary : theme.fill,
                })}
              >
                {key === "del" ? <Icon name="delete.left" color={theme.text} size={24} /> : <Text style={{ fontSize: 32, color: theme.text }}>{key}</Text>}
              </Pressable>
            )
          )}
        </View>
      ))}
    </View>
  );
}
