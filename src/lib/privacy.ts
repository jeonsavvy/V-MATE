const MASK_CHAR = "*"

const maskLocalPart = (localPart: string): string => {
  if (!localPart) {
    return ""
  }

  if (localPart.length <= 2) {
    return `${localPart[0] ?? ""}${MASK_CHAR}`
  }

  const visiblePrefix = localPart.slice(0, 2)
  const hiddenLength = Math.max(1, localPart.length - 2)
  return `${visiblePrefix}${MASK_CHAR.repeat(hiddenLength)}`
}

export const maskEmailAddress = (email: unknown): string => {
  const normalized = String(email || "").trim().toLowerCase()
  if (!normalized.includes("@")) {
    return ""
  }

  const [localPart, domainPart] = normalized.split("@")
  if (!localPart || !domainPart) {
    return ""
  }

  return `${maskLocalPart(localPart)}@${domainPart}`
}
