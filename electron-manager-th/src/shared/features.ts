export const FEATURES = {
  comment: true,
  share: true,
  like: true,
  workflowFollowUp: true,
  pendingApprovalDetector: true,
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
