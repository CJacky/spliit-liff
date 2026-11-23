ALTER TABLE "Group" ADD COLUMN "creatorLineUserId" TEXT;

-- 既有群組沒有記錄建立者：只有一位成員綁定 LINE 時，推定他就是建立者
-- （新建群組時只有建立者會綁定 LINE，其他人是之後才認領）。
-- 有多位綁定成員的群組無法判斷，維持 NULL，也就是沒有人能刪除。
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
