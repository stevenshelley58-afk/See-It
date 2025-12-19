-- CreateTable
CREATE TABLE "saved_room_owners" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_room_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_rooms" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "title" TEXT,
    "original_image_key" TEXT NOT NULL,
    "cleaned_image_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saved_room_owners_shop_id_email_key" ON "saved_room_owners"("shop_id", "email");

-- CreateIndex
CREATE INDEX "saved_room_owners_shop_id_email_idx" ON "saved_room_owners"("shop_id", "email");

-- CreateIndex
CREATE INDEX "saved_rooms_shop_id_owner_id_idx" ON "saved_rooms"("shop_id", "owner_id");

-- AddForeignKey
ALTER TABLE "saved_room_owners" ADD CONSTRAINT "saved_room_owners_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_rooms" ADD CONSTRAINT "saved_rooms_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_rooms" ADD CONSTRAINT "saved_rooms_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "saved_room_owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
