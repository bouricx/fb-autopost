import { expect, it } from "vitest";
import { pendingApprovalText } from "../electron/automation/pending-approval";
it("recognizes explicit pending approval evidence without matching ordinary success text", () => {
  for (const value of ["Pending admin approval", "Submitted for approval", "รอการอนุมัติจากกลุ่ม", "โพสต์ของคุณอยู่ระหว่างการตรวจสอบ"]) expect(pendingApprovalText.test(value)).toBe(true);
  for (const value of ["โพสต์สำเร็จ", "แสดงความคิดเห็น", "Share now"]) expect(pendingApprovalText.test(value)).toBe(false);
});
