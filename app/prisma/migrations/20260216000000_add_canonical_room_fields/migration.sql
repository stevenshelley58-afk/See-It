-- AlterTable
ALTER TABLE "room_sessions" ADD COLUMN "canonical_room_image_key" TEXT;
ALTER TABLE "room_sessions" ADD COLUMN "canonical_room_width" INTEGER;
ALTER TABLE "room_sessions" ADD COLUMN "canonical_room_height" INTEGER;
ALTER TABLE "room_sessions" ADD COLUMN "canonical_room_ratio_label" TEXT;
ALTER TABLE "room_sessions" ADD COLUMN "canonical_room_ratio_value" DOUBLE PRECISION;
ALTER TABLE "room_sessions" ADD COLUMN "canonical_room_crop" JSONB;
ALTER TABLE "room_sessions" ADD COLUMN "canonical_created_at" TIMESTAMP(3);
