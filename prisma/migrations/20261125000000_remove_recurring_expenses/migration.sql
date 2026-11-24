-- Recurring expenses are no longer supported. Occurrences that were already
-- generated stay as ordinary expenses; only the scheduling data is dropped.

-- DropTable
DROP TABLE "RecurringExpenseLink";

-- AlterTable
ALTER TABLE "Expense" DROP COLUMN "recurrenceRule",
DROP COLUMN "recurringExpenseLinkId";

-- DropEnum
DROP TYPE "RecurrenceRule";
