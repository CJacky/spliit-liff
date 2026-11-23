ALTER TABLE "Group" ADD COLUMN "creatorLineUserId" TEXT;

-- Existing groups have no recorded creator: if exactly one participant is linked to LINE,
-- assume they are the creator (on creation only the creator is linked; others claim later).
-- Groups with multiple linked participants are ambiguous and stay NULL, i.e. nobody can delete them.
UPDATE "Group" g
SET "creatorLineUserId" = p."lineUserId"
FROM (
  SELECT "groupId", MIN("lineUserId") AS "lineUserId"
  FROM "Participant"
  WHERE "lineUserId" IS NOT NULL
  GROUP BY "groupId"
  HAVING COUNT(*) = 1
) p
WHERE g."id" = p."groupId";
