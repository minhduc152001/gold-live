import { Injectable, Logger } from '@nestjs/common';
import * as TelegramBot from 'node-telegram-bot-api';

@Injectable()
export class TelegramService {
  private readonly bot: TelegramBot;
  private readonly logger = new Logger(TelegramService.name);

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not defined');
    }
    this.bot = new TelegramBot(token, { polling: false });
  }

  async sendMessage(message: string): Promise<void> {
    try {
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (!chatId) {
        throw new Error('TELEGRAM_CHAT_ID is not defined');
      }
      await this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
      this.logger.error('Error sending Telegram message:', error);
      throw error;
    }
  }
}
