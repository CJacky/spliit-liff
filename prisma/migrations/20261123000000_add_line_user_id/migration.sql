ALTER TABLE "Participant" ADD COLUMN "lineUserId" TEXT;

CREATE UNIQUE INDEX "Participant_groupId_lineUserId_key"
ON "Participant"("groupId", "lineUserId");
