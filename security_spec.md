# Security Specification — EXAM PLANNER (with Manual UPI Subscription & Admin Control)

## 1. Data Invariants
1. **Tenant Isolation**: Every examination, student record, classroom layout, seating plan, room allocation, notification, and audit log belongs to exactly one `institutionId` owned by a single authenticated `ownerId == request.auth.uid`.
2. **Identity Integrity**: Users can only read/write `/users/{uid}` when `uid == request.auth.uid` and cannot escalate `role` beyond `"coordinator"`.
3. **Admin Authorization**: Administrative actions (`paymentRequests` approve/reject, `subscriptions` create/revoke, `adminAuditLogs` create, `notifications` create) require `isAdmin()`, verifying `request.auth.token.email == 'agarwalpiyush263@gmail.com' && request.auth.token.email_verified == true` (and `admin == true` custom claim when present).
4. **Subscription Validity**: Paid mutations (`exams` create/update/delete, `students` write, `classrooms` write, `seatingPlans` write) require an approved, non-revoked subscription on `/institutions/{institutionId}` where `expiresAt > request.time` (server clock). Historical reads remain permitted.
5. **Immutable Examination Type Lock**: Creating the first exam on a subscription atomically locks `examinationTypeLocked = true` and `lockedExaminationType` on `/subscriptions/{subscriptionId}` using `existsAfter`/`getAfter`. Subsequent exams must match `lockedExaminationType`, existing exam `examType` cannot be mutated on update, and deleting an exam never resets `lockedExaminationType`.
6. **Single Pending Payment Request**: An institution cannot create a new `paymentRequest` while `pendingPaymentRequestId != null` or while an active subscription exists.
7. **Immutability & Temporal Integrity**: `id`, `uid`, `ownerId`, `institutionId`, `subscriptionId`, and `createdAt`/`submittedAt` cannot be modified after creation. Server timestamps (`request.time`) are mandatory.
8. **Private Payment Proofs & Optional Transaction ID**: Firebase Storage `paymentProofs/{institutionId}/{userId}/{fileName}` denies all public access and restricts reads to the uploader (`request.auth.uid == userId`) or verified admin (`isAdmin()`). Firestore `isValidPaymentRequest` accepts an optional/null `transactionReferenceId` while strictly binding `screenshotStoragePath` to `paymentProofs/{institutionId}/{userId}/{fileName}` and verifying `isInstitutionOwner(institutionId)`.

## 2. Adversarial Payloads Blocked
1. **Cross-Tenant Institution Read**: User B attempts `get(/institutions/inst_A)` -> `PERMISSION_DENIED`.
2. **Cross-Tenant Payment Request List**: User B attempts `list(/paymentRequests)` without `userId == request.auth.uid` -> `PERMISSION_DENIED`.
3. **Self-Approved Payment Request**: User A creates `/paymentRequests/req_1` with `status: "approved"` -> `PERMISSION_DENIED` (`status == 'pending'`).
4. **User Approving Own Payment**: User A updates `/paymentRequests/req_1` to `status: "approved"` -> `PERMISSION_DENIED` (`isAdmin()` required).
5. **User Extending Subscription Expiry**: User A updates `expiresAt` on `/subscriptions/sub_1` -> `PERMISSION_DENIED` (`isAdmin()` required).
6. **User Changing Locked Exam Type**: User A updates `lockedExaminationType` after `examinationTypeLocked == true` -> `PERMISSION_DENIED`.
7. **Locking Type Without Creating Exam**: User A updates `subscriptions/sub_1` to set `lockedExaminationType: "Unit Test"` without an atomic exam write -> `PERMISSION_DENIED` (`existsAfter` + `getAfter` fails).
8. **Creating Exam With Wrong Exam Type**: User A creates an exam with `examType: "Semester Final"` when subscription is locked to `"Mid Term"` -> `PERMISSION_DENIED`.
9. **Mutating Existing Exam Type**: User A updates `examType` on an existing `"Mid Term"` exam -> `PERMISSION_DENIED` (`incoming().examType == existing().examType`).
10. **Creating Exam After Expiry**: User A creates an exam when `sub.expiresAt <= request.time` -> `PERMISSION_DENIED`.
11. **Spoofed Unverified Admin Email**: Attacker signs up with unverified email `agarwalpiyush263@gmail.com` (`email_verified: false`) -> `PERMISSION_DENIED`.
12. **Double Payment Approval**: Admin attempts to approve an already approved `paymentRequest` -> `PERMISSION_DENIED` (`existing().status == 'pending'`) and transaction aborts.
