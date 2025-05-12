import { Module } from '@nestjs/common';
import { GoldService } from './gold.service';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [TelegramModule],
  providers: [GoldService],
  exports: [GoldService],
})
export class GoldModule {}
