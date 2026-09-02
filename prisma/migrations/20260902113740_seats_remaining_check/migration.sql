ALTER TABLE "LaunchEvent" ADD CONSTRAINT seats_remaining_non_negative CHECK ("seatsRemaining" >= 0);
