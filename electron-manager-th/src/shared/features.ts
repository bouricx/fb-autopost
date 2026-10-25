export const FEATURES = {
  comment: false,
  share: false,
  like: false,
  workflowFollowUp: false,
  pendingApprovalDetector: false,
  groupPermissionCheck: false,
} as const;

export type FeatureFlags = { [K in keyof typeof FEATURES]: boolean };

export type DisabledAction = "comment" | "share" | "like";

export function assertActionEnabled(action: DisabledAction): void {
  if (!FEATURES[action]) {
    const label = { comment: "คอมเมนต์", share: "แชร์", like: "ไลค์" }[action];
    throw new Error(`ฟีเจอร์${label}ยังปิดใช้งานอยู่ สามารถเปิดได้ภายหลัง`);
  }
}
