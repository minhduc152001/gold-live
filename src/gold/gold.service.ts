import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios, { AxiosError } from 'axios';
import { ConfigService } from '@nestjs/config';
import { TelegramService } from '../telegram/telegram.service';
import * as xml2js from 'xml2js';

interface GoldApiResponse {
  timestamp: number;
  metal: string;
  currency: string;
  exchange: string;
  symbol: string;
  prev_close_price: number;
  open_price: number;
  low_price: number;
  high_price: number;
  open_time: number;
  price: number;
  ch: number;
  chp: number;
  ask: number;
  bid: number;
}

interface DojiGoldResponse {
  GoldList: {
    DGPlist: Array<{
      DateTime: string[];
      Row: Array<{
        $: {
          Name: string;
          Key: string;
          Sell: string;
          Buy: string;
        };
      }>;
    }>;
    JewelryList: Array<{
      DateTime: string[];
      Row: Array<{
        $: {
          Name: string;
          Key: string;
          Sell: string;
          Buy: string;
        };
      }>;
    }>;
  };
}

interface BTMCGoldResponse {
  DataList: {
    Data: Array<{
      [key: string]: string;
    }>;
  };
}

class GoldPriceError extends Error {
  constructor(
    message: string,
    public readonly source: string,
  ) {
    super(message);
    this.name = 'GoldPriceError';
  }
}

@Injectable()
export class GoldService {
  private readonly logger = new Logger(GoldService.name);
  private readonly BTMC_API_KEY: string;
  private readonly DOJI_API_KEY: string;
  private readonly GOLD_API_TOKEN: string;
  private readonly parser: xml2js.Parser;

  constructor(
    private readonly telegramService: TelegramService,
    private readonly configService: ConfigService,
  ) {
    this.BTMC_API_KEY = this.configService.get<string>('BTMC_API_KEY') || '';
    this.DOJI_API_KEY = this.configService.get<string>('DOJI_API_KEY') || '';
    this.GOLD_API_TOKEN =
      this.configService.get<string>('GOLD_API_TOKEN') || '';
    this.parser = new xml2js.Parser();

    if (!this.BTMC_API_KEY || !this.DOJI_API_KEY || !this.GOLD_API_TOKEN) {
      throw new Error(
        'Required API keys are not configured in environment variables',
      );
    }
    this.logger.log('GoldService initialized with API keys');
  }

  @Cron('*/10 * * * *') // Run every 10 minutes
  async fetchAndNotifyPrices() {
    this.logger.log('Starting to fetch gold prices...');
    const startTime = Date.now();

    try {
      this.logger.log('Fetching world gold price...');
      const worldPrice = await this.fetchWorldGoldPrice();
      this.logger.log(
        `World gold price fetched: $${this.formatNumber(worldPrice)}/oz`,
      );

      this.logger.log('Fetching DOJI prices...');
      const dojiPrices = await this.fetchDojiPrice();
      this.logger.log('DOJI prices fetched successfully');

      this.logger.log('Fetching BTMC prices...');
      const btmcPrices = await this.fetchBaoTinPrice();
      this.logger.log('BTMC prices fetched successfully');

      const message = `
🕒 Gold Prices Update (${new Date().toLocaleString()})

🌍 World Gold Price: $${this.formatNumber(worldPrice)}/oz

🏪 Local Gold Shops:

DOJI:
${dojiPrices}

Bảo Tín Minh Châu:
${btmcPrices}
      `;

      this.logger.log('Sending notification to Telegram...');
      await this.telegramService.sendMessage(message);
      this.logger.log('Notification sent successfully');

      const duration = Date.now() - startTime;
      this.logger.log(`Price update completed in ${duration}ms`);
    } catch (error) {
      this.logger.error('Error fetching gold prices:', error);
      if (error instanceof GoldPriceError) {
        this.logger.error(
          `Error fetching ${error.source} prices: ${error.message}`,
        );
        await this.telegramService.sendMessage(
          `⚠️ Error fetching ${error.source} prices: ${error.message}`,
        );
      }
    }
  }

  private formatNumber(num: number | string): string {
    const numStr = num.toString();
    return numStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  private async fetchWorldGoldPrice(): Promise<number> {
    try {
      this.logger.debug('Making request to Gold API...');
      const response = await axios.get<GoldApiResponse>(
        'https://www.goldapi.io/api/XAU/USD',
        {
          headers: {
            'x-access-token': this.GOLD_API_TOKEN,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.debug('Gold API response received');
      return response.data.price;
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger.error(
          `Gold API error: ${error.response?.status} - ${error.response?.statusText}`,
        );
        throw new GoldPriceError(
          `API Error: ${error.response?.status} - ${error.response?.statusText}`,
          'World Gold',
        );
      }
      this.logger.error('Failed to fetch world gold price:', error);
      throw new GoldPriceError(
        'Failed to fetch world gold price',
        'World Gold',
      );
    }
  }

  private async fetchDojiPrice(): Promise<string> {
    try {
      this.logger.debug('Making request to DOJI API...');
      const response = await axios.get(
        `http://giavang.doji.vn/api/giavang/?api_key=${this.DOJI_API_KEY}`,
      );
      this.logger.debug('DOJI API response received');

      // Parse XML response
      const result = await this.parser.parseStringPromise(response.data);
      const data = result as DojiGoldResponse;

      // Get SJC prices from DGPlist
      const sjcPrices = data.GoldList.DGPlist[0].Row.filter((row) =>
        row.$.Name.includes('DOJI'),
      )
        .map(
          (row) =>
            `- ${row.$.Name}:\n  Mua: ${this.formatNumber(row.$.Buy)} VND\n  Bán: ${this.formatNumber(row.$.Sell)} VND`,
        )
        .join('\n');

      // Get 24K prices from JewelryList
      const jewelryPrices = data.GoldList.JewelryList[0].Row.filter(
        (row) => row.$.Name.includes('24k') || row.$.Name.includes('9999'),
      )
        .map(
          (row) =>
            `- ${row.$.Name}:\n  Mua: ${this.formatNumber(row.$.Buy)} VND\n  Bán: ${this.formatNumber(row.$.Sell)} VND`,
        )
        .join('\n');

      return `${sjcPrices}\n${jewelryPrices}`;
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger.error(
          `DOJI API error: ${error.response?.status} - ${error.response?.statusText}`,
        );
        throw new GoldPriceError(
          `API Error: ${error.response?.status} - ${error.response?.statusText}`,
          'DOJI',
        );
      }
      this.logger.error('Failed to fetch DOJI prices:', error);
      throw new GoldPriceError('Failed to fetch DOJI prices', 'DOJI');
    }
  }

  private async fetchBaoTinPrice(): Promise<string> {
    try {
      this.logger.debug('Making request to BTMC API...');
      const response = await axios.get<BTMCGoldResponse>(
        `http://api.btmc.vn/api/BTMCAPI/getpricebtmc?key=${this.BTMC_API_KEY}`,
      );
      this.logger.debug('BTMC API response received', response.data);

      // Filter and format prices for SJC and 24K gold
      const prices = response.data.DataList.Data.filter((item) => {
        const name =
          item['@n_1'] ||
          item['@n_2'] ||
          item['@n_3'] ||
          item['@n_4'] ||
          item['@n_5'];
        const karat =
          item['@k_1'] ||
          item['@k_2'] ||
          item['@k_3'] ||
          item['@k_4'] ||
          item['@k_5'];
        const purity =
          item['@h_1'] ||
          item['@h_2'] ||
          item['@h_3'] ||
          item['@h_4'] ||
          item['@h_5'];

        return name?.includes('SJC') || (karat === '24k' && purity === '999.9');
      });
      this.logger.debug(`Found ${prices.length} BTMC price types`);

      const formattedPrices = prices
        .map((item) => {
          const name =
            item['@n_1'] ||
            item['@n_2'] ||
            item['@n_3'] ||
            item['@n_4'] ||
            item['@n_5'];
          const buyPrice =
            item['@pb_1'] ||
            item['@pb_2'] ||
            item['@pb_3'] ||
            item['@pb_4'] ||
            item['@pb_5'];
          const sellPrice =
            item['@ps_1'] ||
            item['@ps_2'] ||
            item['@ps_3'] ||
            item['@ps_4'] ||
            item['@ps_5'];

          const type = name?.includes('SJC') ? 'SJC' : 'Vàng 24K (999.9)';
          return `- ${type}:\n  Mua: ${this.formatNumber(buyPrice)} VND\n  Bán: ${this.formatNumber(sellPrice)} VND`;
        })
        .join('\n');

      return formattedPrices;
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger.error(
          `BTMC API error: ${error.response?.status} - ${error.response?.statusText}`,
        );
        throw new GoldPriceError(
          `API Error: ${error.response?.status} - ${error.response?.statusText}`,
          'BTMC',
        );
      }
      this.logger.error('Failed to fetch BTMC prices:', error);
      throw new GoldPriceError('Failed to fetch BTMC prices', 'BTMC');
    }
  }
}
