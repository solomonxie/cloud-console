// Grouped-list building blocks shaped after the SwiftUI screens: cards,
// inset sections, rows, icon badges, content-unavailable states.
import React, { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  RefreshControl,
  type ScrollViewProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SymbolView, type SFSymbol } from "expo-symbols";
import * as Clipboard from "expo-clipboard";
import { MONO, useTheme } from "../theme";

export function Icon({ name, color, size = 17 }: { name: string; color?: string; size?: number }) {
  const theme = useTheme();
  return <SymbolView name={name as SFSymbol} tintColor={color ?? theme.text} size={size} resizeMode="scaleAspectFit" style={{ width: size, height: size }} />;
}

/** Rounded, colored icon badge — same shape as iOS Settings rows. */
export function Badge({ icon, color, size = 32 }: { icon: string; color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} color="#FFFFFF" size={size * 0.5} />
    </View>
  );
}

export function Screen({ children, refreshing, onRefresh, footer, style, ...rest }: ScrollViewProps & { refreshing?: boolean; onRefresh?: () => void; footer?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        contentContainerStyle={[{ paddingVertical: 16, paddingBottom: footer ? 56 : 32 }, style as StyleProp<ViewStyle>]}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
        {...rest}
      >
        {children}
      </ScrollView>
      {footer}
    </View>
  );
}

/** Bottom status bar (Swift `.safeAreaInset(edge: .bottom)` + `.bar`). */
export function StatusBar({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingVertical: 8, paddingBottom: 24, backgroundColor: theme.bar, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}>
      {children}
    </View>
  );
}

export function Section({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  const theme = useTheme();
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
      {title ? <Text style={{ color: theme.secondary, fontSize: 13, marginLeft: 16, marginBottom: 6, textTransform: "uppercase" }}>{title}</Text> : null}
      {items.length > 0 ? (
        <View style={{ backgroundColor: theme.card, borderRadius: 10, overflow: "hidden" }}>
          {items.map((child, i) => (
            <View key={i}>
              {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.separator, marginLeft: 16 }} /> : null}
              {child}
            </View>
          ))}
        </View>
      ) : null}
      {footer ? <View style={{ marginHorizontal: 16, marginTop: 6 }}>{typeof footer === "string" ? <Caption>{footer}</Caption> : footer}</View> : null}
    </View>
  );
}

/** Floating card with a hairline between rows (Home connection card / Settings card). */
export function Card({ children, indent = 68 }: { children: ReactNode; indent?: number }) {
  const theme = useTheme();
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ backgroundColor: theme.card, borderRadius: 22, marginHorizontal: 16, marginBottom: 20, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.separator, marginLeft: indent }} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

export function Row({ children, onPress, onLongPress, chevron, style }: { children: ReactNode; onPress?: () => void; onLongPress?: () => void; chevron?: boolean; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const content = (
    <View style={[{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 11, minHeight: 44, gap: 12 }, style]}>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}>{children}</View>
      {chevron ? <Icon name="chevron.right" color={theme.tertiary} size={13} /> : null}
    </View>
  );
  if (!onPress && !onLongPress) return content;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => ({ backgroundColor: pressed ? theme.fill : "transparent" })}>
      {content}
    </Pressable>
  );
}

export function Title({ children, numberOfLines = 1, style }: { children: ReactNode; numberOfLines?: number; style?: StyleProp<TextStyle> }) {
  const theme = useTheme();
  return (
    <Text numberOfLines={numberOfLines} ellipsizeMode="middle" style={[{ color: theme.text, fontSize: 17 }, style]}>
      {children}
    </Text>
  );
}

export function Caption({ children, numberOfLines, color, style }: { children: ReactNode; numberOfLines?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const theme = useTheme();
  return (
    <Text numberOfLines={numberOfLines} ellipsizeMode="middle" style={[{ color: color ?? theme.secondary, fontSize: 12 }, style]}>
      {children}
    </Text>
  );
}

/** Title + caption stack used by resource rows. */
export function TwoLine({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Title>{title}</Title>
      {subtitle ? <Caption numberOfLines={1}>{subtitle}</Caption> : null}
    </View>
  );
}

export function ResourceRow({ icon, color, title, subtitle, onPress, onLongPress, trailing }: { icon: string; color: string; title: string; subtitle?: string; onPress?: () => void; onLongPress?: () => void; trailing?: ReactNode }) {
  return (
    <Row onPress={onPress} onLongPress={onLongPress} chevron={!!onPress && !trailing}>
      <Badge icon={icon} color={color} />
      <TwoLine title={title} subtitle={subtitle} />
      {trailing}
    </Row>
  );
}

/** One line, middle-truncated; tap to show the full value; long-press copies it. */
export function DetailRow({ label, value, wrap }: { label: string; value: string; wrap?: boolean }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable onPress={() => setExpanded((e) => !e)} onLongPress={() => void Clipboard.setStringAsync(value)}>
      <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingVertical: 11, gap: 12, alignItems: "flex-start" }}>
        <Text style={{ color: theme.text, fontSize: 17 }}>{label}</Text>
        <Text selectable numberOfLines={wrap || expanded ? undefined : 1} ellipsizeMode="middle" style={{ flex: 1, color: theme.secondary, fontSize: 17, textAlign: "right" }}>
          {value}
        </Text>
      </View>
    </Pressable>
  );
}

export function Loading({ label }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: theme.background, paddingTop: 80 }}>
      <ActivityIndicator />
      {label ? <Text style={{ color: theme.secondary }}>{label}</Text> : null}
    </View>
  );
}

/** SwiftUI ContentUnavailableView. */
export function Unavailable({ icon, title, message, action }: { icon: string; title: string; message?: string; action?: { label: string; onPress: () => void; prominent?: boolean } }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: "center", justifyContent: "center", padding: 32, gap: 10, minHeight: 280 }}>
      <Icon name={icon} color={theme.secondary} size={44} />
      <Text style={{ color: theme.text, fontSize: 22, fontWeight: "700", textAlign: "center" }}>{title}</Text>
      {message ? <Text style={{ color: theme.secondary, fontSize: 15, textAlign: "center" }}>{message}</Text> : null}
      {action ? <Button label={action.label} onPress={action.onPress} prominent={action.prominent} /> : null}
    </View>
  );
}

export function Button({ label, onPress, prominent, destructive, disabled, icon }: { label: string; onPress: () => void; prominent?: boolean; destructive?: boolean; disabled?: boolean; icon?: string }) {
  const theme = useTheme();
  const color = destructive ? theme.red : prominent ? "#FFFFFF" : theme.tint;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: prominent ? 18 : 4,
        paddingVertical: prominent ? 10 : 6,
        borderRadius: 20,
        backgroundColor: prominent ? theme.tint : "transparent",
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      {icon ? <Icon name={icon} color={color} size={16} /> : null}
      <Text style={{ color, fontSize: 17, fontWeight: prominent ? "600" : "400" }}>{label}</Text>
    </Pressable>
  );
}

export function LinkRow({ label, onPress, color, icon, disabled, trailing }: { label: string; onPress: () => void; color?: string; icon?: string; disabled?: boolean; trailing?: ReactNode }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => ({ backgroundColor: pressed ? theme.fill : "transparent", opacity: disabled ? 0.4 : 1 })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 11, minHeight: 44 }}>
        {icon ? <Icon name={icon} color={color ?? theme.tint} size={17} /> : null}
        <Text style={{ color: color ?? theme.tint, fontSize: 17, flex: 1 }}>{label}</Text>
        {trailing}
      </View>
    </Pressable>
  );
}

/** Selectable monospaced text; long-press copies. */
export function CodeBlock({ text, scroll = true }: { text: string; scroll?: boolean }) {
  const theme = useTheme();
  const body = (
    <Text selectable style={{ fontFamily: MONO, fontSize: 12, color: theme.text }}>
      {text}
    </Text>
  );
  return (
    <Pressable onLongPress={() => void Clipboard.setStringAsync(text)} style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
      {scroll ? <ScrollView horizontal showsHorizontalScrollIndicator>{body}</ScrollView> : body}
    </Pressable>
  );
}

/** DisclosureGroup: label row that expands its content in place. */
export function Disclosure({ label, children, initiallyOpen = false, onToggle }: { label: ReactNode; children: ReactNode; initiallyOpen?: boolean; onToggle?: (open: boolean) => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View>
      <Pressable
        onPress={() => {
          setOpen(!open);
          onToggle?.(!open);
        }}
        style={({ pressed }) => ({ backgroundColor: pressed ? theme.fill : "transparent" })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 11, gap: 10 }}>
          <View style={{ flex: 1 }}>{label}</View>
          <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
            <Icon name="chevron.right" color={theme.tint} size={13} />
          </View>
        </View>
      </Pressable>
      {open ? <View style={{ paddingLeft: 12 }}>{children}</View> : null}
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 11 }}>
      <Caption>{children}</Caption>
    </View>
  );
}

export function Spinner() {
  return (
    <View style={{ padding: 12, alignItems: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
