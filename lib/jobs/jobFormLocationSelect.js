import React from "react";

/** Normalize SAP / masterlist address type to B (billing) or S (shipping). */
export function normalizeSapAddressType(addressType) {
  const t = String(addressType || "").trim().toUpperCase();
  if (t === "B" || t === "BO_BILLTO" || t === "BILLTO") return "B";
  if (t === "S" || t === "BO_SHIPTO" || t === "SHIPTO") return "S";
  return t || "";
}

/** Safe text for React children — never render plain objects/arrays. */
function asReactText(value) {
  if (value == null || value === false) return "";
  if (typeof value === "string" || typeof value === "number") return value;
  return "";
}

function locationPrimaryLabel(item) {
  return (
    asReactText(item?.value) ||
    asReactText(item?.siteId) ||
    asReactText(item?.address) ||
    ""
  );
}

export function formatLocationSelectOption(item) {
  const buildingPrefix = asReactText(item.building)
    ? `${asReactText(item.building)} - `
    : "";
  const primary =
    asReactText(item.address) || asReactText(item.siteId) || "";

  return {
    value: item.siteId,
    label: (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontWeight: "bold" }}>
          {buildingPrefix}
          {primary}
        </div>
        <div style={{ fontSize: "0.85em", color: "#666" }}>
          {[item.city, item.stateProvince, item.zipCode, item.countryName]
            .map(asReactText)
            .filter(Boolean)
            .join(", ")}
        </div>
      </div>
    ),
    subLabel: `${item.city || ""}, ${item.stateProvince || ""} ${item.zipCode || ""}`.trim(),
    addressType: normalizeSapAddressType(item.addressType),
    ...item,
  };
}

/** Group locations for react-select; includes billing/other when shipping is empty. */
export function buildGroupedLocationOptions(rawItems = []) {
  const formattedLocations = rawItems
    .filter((item) => item && (item.siteId || item.address))
    .sort((a, b) => {
      const typeA = normalizeSapAddressType(a.addressType);
      const typeB = normalizeSapAddressType(b.addressType);
      if (typeA === "B" && typeB === "S") return -1;
      if (typeA === "S" && typeB === "B") return 1;
      return String(a.address || a.siteId || "").localeCompare(
        String(b.address || b.siteId || "")
      );
    })
    .map(formatLocationSelectOption);

  const shipping = formattedLocations.filter(
    (loc) => normalizeSapAddressType(loc.addressType) === "S"
  );
  const billing = formattedLocations.filter(
    (loc) => normalizeSapAddressType(loc.addressType) === "B"
  );
  const other = formattedLocations.filter((loc) => {
    const type = normalizeSapAddressType(loc.addressType);
    return type !== "S" && type !== "B";
  });

  const groups = [];
  if (shipping.length > 0) {
    groups.push({ label: "Shipping Addresses", options: shipping });
  }
  if (billing.length > 0) {
    groups.push({ label: "Billing Addresses", options: billing });
  }
  if (other.length > 0) {
    groups.push({ label: "Other Addresses", options: other });
  }

  return groups.length > 0 ? groups : formattedLocations;
}

export function countGroupedLocationOptions(grouped) {
  if (!Array.isArray(grouped) || grouped.length === 0) return 0;
  if (grouped[0]?.options) {
    return grouped.reduce((sum, group) => sum + (group.options?.length || 0), 0);
  }
  return grouped.length;
}

/** Flatten grouped react-select options for saved-location matching. */
export function flattenLocationOptions(grouped) {
  if (!Array.isArray(grouped) || grouped.length === 0) return [];
  if (grouped[0]?.options) {
    return grouped.flatMap((group) => group.options || []);
  }
  return grouped;
}

export function locationSelectGroupLabel(data) {
  const optionCount = data?.options?.length ?? 0;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: "0.9em",
        fontWeight: "bold",
        padding: "8px 0",
        color: "#2c3e50",
        borderBottom: "2px solid #eee",
        width: "100%",
      }}
    >
      <span>{asReactText(data?.label)}</span>
      <span
        style={{
          background: "#e9ecef",
          borderRadius: "4px",
          padding: "2px 8px",
          fontSize: "0.8em",
        }}
      >
        {optionCount}
      </span>
    </div>
  );
}

export function locationSelectOptionLabel(option) {
  const addressType = normalizeSapAddressType(option?.addressType);
  const showBadge = addressType === "B" || addressType === "S";
  const primary = locationPrimaryLabel(option);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "4px 0",
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontWeight: "500",
            color: "#2c3e50",
            marginBottom: "2px",
          }}
        >
          {primary}
        </div>
        <div
          style={{
            fontSize: "0.85em",
            color: "#666",
            lineHeight: "1.3",
          }}
        >
          {[option?.street, option?.building, option?.countryName, option?.zipCode]
            .map(asReactText)
            .filter(Boolean)
            .join(", ")}
        </div>
      </div>
      {showBadge && (
        <div
          style={{
            fontSize: "0.75em",
            padding: "3px 8px",
            borderRadius: "12px",
            background: addressType === "B" ? "#e3f2fd" : "#fff3e0",
            color: addressType === "B" ? "#1976d2" : "#f57c00",
            whiteSpace: "nowrap",
            alignSelf: "center",
          }}
        >
          {addressType === "B" ? "Billing" : "Shipping"}
        </div>
      )}
    </div>
  );
}

export const locationSelectStyles = {
  control: (base) => ({
    ...base,
    minHeight: "45px",
    borderColor: "#dee2e6",
    "&:hover": {
      borderColor: "#80bdff",
    },
  }),
  group: (base) => ({
    ...base,
    paddingTop: 8,
    paddingBottom: 8,
  }),
  option: (base, state) => ({
    ...base,
    padding: "8px 12px",
    borderBottom: "1px solid #f0f0f0",
    backgroundColor: state.isFocused ? "#f8f9fa" : "white",
    cursor: "pointer",
    "&:hover": {
      backgroundColor: "#f8f9fa",
    },
  }),
  menu: (base) => ({
    ...base,
    zIndex: 9999,
    boxShadow:
      "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)",
  }),
  groupHeading: (base) => ({
    ...base,
    margin: "8px 0",
    fontSize: "0.9em",
    fontWeight: "bold",
  }),
};
