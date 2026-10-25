import { InputFile, InlineKeyboard } from 'grammy';
import { logger } from '../utils/logger.js';

/**
 * Formats CSV rows from orders data.
 * @param {Array<Record<string, any>>} orders
 * @returns {string}
 */
function ordersToCsv(orders) {
  if (!orders || orders.length === 0) {
    return 'order_id,telegram_id,product_name,product_version,price_stars,currency,payment_status,delivery_status,telegram_payment_charge_id,created_at,paid_at,delivered_at,last_delivery_error\n';
  }

  const headers = Object.keys(orders[0]);
  const escapeCell = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerRow = headers.join(',');
  const rows = orders.map((row) => headers.map((col) => escapeCell(row[col])).join(','));

  return [headerRow, ...rows].join('\n');
}

/**
 * Handles /admin command.
 */
export async function handleAdminMenu(ctx) {
  const text =
    `🛠 <b>Administrator Control Panel</b>\n\n` +
    `Available administrative commands:\n\n` +
    `📊 <b>Analytics & Orders:</b>\n` +
    `• /stats - View sales analytics & order aggregates\n` +
    `• /orders - View recent orders list (with pagination: <code>/orders 2</code>)\n` +
    `• /orders &lt;ORDER_ID&gt; - Inspect specific order details\n` +
    `• /export - Export all orders as a CSV document\n\n` +
    `⚙️ <b>Settings & Overrides:</b>\n` +
    `• /price - View current active Stars price\n` +
    `• /setprice &lt;amount&gt; - Override price at runtime (e.g. <code>/setprice 250</code>)\n` +
    `• /setversion &lt;version&gt; - Override app version (e.g. <code>/setversion 12.10.2</code>)\n\n` +
    `🚚 <b>Fulfillment & Operations:</b>\n` +
    `• /retrydelivery &lt;ORDER_ID&gt; - Retry APK delivery for a paid order`;

  const keyboard = new InlineKeyboard()
    .text('📊 Quick Stats', 'admin_quick_stats')
    .text('📑 Recent Orders', 'admin_quick_orders')
    .row()
    .text('📥 Export Orders CSV', 'admin_quick_export');

  await ctx.reply(text, {
    reply_markup: keyboard,
    parse_mode: 'HTML'
  });
}

/**
 * Handles /stats command.
 * @param {import('grammy').Context} ctx
 * @param {import('../database/repositories.js').OrderRepository} orderRepo
 */
export async function handleStatsCommand(ctx, orderRepo) {
  const stats = await orderRepo.getStats();

  const text =
    `📊 <b>Sales & Order Analytics</b>\n\n` +
    `<i>Note: These metrics reflect database-recorded transactions and do not represent Telegram's official withdrawable revenue balance. Official balances and withdrawals are managed in @BotFather or Fragment.</i>\n\n` +
    `• <b>Total Orders:</b> ${stats.total_orders}\n` +
    `• <b>Successful Orders (Paid):</b> ${stats.successful_orders}\n` +
    `• <b>Pending Invoices:</b> ${stats.pending_payments}\n` +
    `• <b>Failed Deliveries:</b> ${stats.failed_deliveries}\n\n` +
    `💰 <b>Recorded Stars Revenue:</b>\n` +
    `• <b>All-time Stars:</b> ⭐ ${stats.total_stars} Stars\n` +
    `• <b>Today's Sales:</b> ${stats.sales_today_count} orders (⭐ ${stats.sales_today_stars} Stars)\n` +
    `• <b>Last 7 Days Sales:</b> ${stats.sales_7d_count} orders (⭐ ${stats.sales_7d_stars} Stars)`;

  await ctx.reply(text, { parse_mode: 'HTML' });
}

/**
 * Handles /orders and /orders <ORDER_ID> commands.
 *
 * @param {import('grammy').Context} ctx
 * @param {import('../database/repositories.js').OrderRepository} orderRepo
 */
export async function handleOrdersCommand(ctx, orderRepo) {
  const text = ctx.message?.text?.trim() || '';
  const parts = text.split(/\s+/);
  const param = parts[1];

  // If parameter starts with ORD- or is an order ID string
  if (param && (param.startsWith('ORD-') || (param.length > 8 && isNaN(Number(param))))) {
    const order = await orderRepo.findByOrderId(param);
    if (!order) {
      await ctx.reply(`❌ Order <code>${param}</code> not found.`, { parse_mode: 'HTML' });
      return;
    }

    const details =
      `🔍 <b>Order Details:</b> <code>${order.order_id}</code>\n\n` +
      `• <b>Customer Telegram ID:</b> <code>${order.telegram_id}</code>\n` +
      `• <b>Product:</b> ${order.product_name} (v${order.product_version})\n` +
      `• <b>Price:</b> ⭐ ${order.price_stars} ${order.currency}\n` +
      `• <b>Payment Status:</b> <b>${order.payment_status}</b>\n` +
      `• <b>Delivery Status:</b> <b>${order.delivery_status}</b>\n` +
      `• <b>Telegram Charge ID:</b> <code>${order.telegram_payment_charge_id || 'None'}</code>\n` +
      `• <b>Created At:</b> ${order.created_at}\n` +
      `• <b>Paid At:</b> ${order.paid_at || 'Not paid'}\n` +
      `• <b>Delivered At:</b> ${order.delivered_at || 'Not delivered'}\n` +
      (order.last_delivery_error ? `• <b>Last Error:</b> <i>${order.last_delivery_error}</i>\n` : '') +
      `\nTo retry delivery: <code>/retrydelivery ${order.order_id}</code>`;

    await ctx.reply(details, { parse_mode: 'HTML' });
    return;
  }

  // Pagination mode: /orders or /orders <page>
  const page = Math.max(1, parseInt(param, 10) || 1);
  const pageSize = 10;
  const offset = (page - 1) * pageSize;

  const total = await orderRepo.countAll();
  const totalPages = Math.ceil(total / pageSize) || 1;
  const orders = await orderRepo.findAll(pageSize, offset);

  if (orders.length === 0) {
    await ctx.reply('📑 No orders recorded in the database.');
    return;
  }

  let msg = `📑 <b>Orders List (Page ${page} of ${totalPages})</b>\n\n`;
  for (const ord of orders) {
    const payIcon = ord.payment_status === 'PAID' ? '✅' : ord.payment_status === 'PENDING' ? '⏳' : '❌';
    const delivIcon = ord.delivery_status === 'DELIVERED' ? '📦' : ord.delivery_status === 'FAILED' ? '⚠️' : '⏳';
    msg +=
      `• <code>${ord.order_id}</code> | User: <code>${ord.telegram_id}</code>\n` +
      `  v${ord.product_version} | ⭐ ${ord.price_stars} Stars | Pay: ${payIcon} ${ord.payment_status} | Deliv: ${delivIcon} ${ord.delivery_status}\n` +
      `  Created: ${new Date(ord.created_at).toLocaleString('en-US', { timeZone: 'UTC' })} UTC\n\n`;
  }

  if (page < totalPages) {
    msg += `For next page: <code>/orders ${page + 1}</code>\n`;
  }
  msg += `To inspect an order: <code>/orders &lt;ORDER_ID&gt;</code>`;

  await ctx.reply(msg, { parse_mode: 'HTML' });
}

/**
 * Handles /price command.
 *
 * @param {import('grammy').Context} ctx
 * @param {import('../services/orderService.js').OrderService} orderService
 */
export async function handlePriceCommand(ctx, orderService) {
  const { price, isOverridden } = await orderService.getActivePrice();
  const source = isOverridden ? 'Runtime MongoDB Database Override' : '.env (PRICE_STARS)';

  const text =
    `🏷 <b>Active Stars Price</b>\n\n` +
    `• <b>Price:</b> ⭐ <b>${price} Stars</b>\n` +
    `• <b>Source:</b> ${source}\n\n` +
    `To change the price at runtime, use:\n` +
    `<code>/setprice &lt;positive_integer&gt;</code>`;

  await ctx.reply(text, { parse_mode: 'HTML' });
}

/**
 * Handles /setprice <amount> command.
 *
 * @param {import('grammy').Context} ctx
 * @param {import('../database/repositories.js').SettingsRepository} settingsRepo
 */
export async function handleSetPriceCommand(ctx, settingsRepo) {
  const text = ctx.message?.text?.trim() || '';
  const parts = text.split(/\s+/);
  const inputPrice = parts[1];

  if (!inputPrice) {
    await ctx.reply('⚠️ Usage: <code>/setprice &lt;positive_integer&gt;</code> (e.g. <code>/setprice 250</code>)', {
      parse_mode: 'HTML'
    });
    return;
  }

  const parsed = parseInt(inputPrice, 10);
  if (isNaN(parsed) || parsed <= 0 || String(parsed) !== inputPrice) {
    await ctx.reply('❌ Invalid price. The price must be a positive integer greater than zero (e.g. 250).');
    return;
  }

  await settingsRepo.setPriceOverride(parsed);
  logger.info({ newPrice: parsed }, 'Admin updated active Stars price override in database');

  await ctx.reply(
    `✅ <b>Price updated successfully!</b>\n\n` +
    `New active price: ⭐ <b>${parsed} Stars</b>\n` +
    `This override is stored in MongoDB Atlas and will persist across restarts.\n` +
    `All newly created orders will use this price. Existing orders retain their original locked price.`,
    { parse_mode: 'HTML' }
  );
}

/**
 * Handles /setversion <version> command.
 *
 * @param {import('grammy').Context} ctx
 * @param {import('../database/repositories.js').SettingsRepository} settingsRepo
 */
export async function handleSetVersionCommand(ctx, settingsRepo) {
  const text = ctx.message?.text?.trim() || '';
  const parts = text.split(/\s+/);
  const inputVersion = parts[1];

  if (!inputVersion) {
    await ctx.reply('⚠️ Usage: <code>/setversion &lt;version_string&gt;</code> (e.g. <code>/setversion 12.10.2</code>)', {
      parse_mode: 'HTML'
    });
    return;
  }

  const version = inputVersion.trim();
  await settingsRepo.setVersionOverride(version);
  logger.info({ newVersion: version }, 'Admin updated active version override in database');

  await ctx.reply(
    `✅ <b>Version updated successfully!</b>\n\n` +
    `New active version: <code>${version}</code>\n` +
    `This override is stored in MongoDB Atlas and takes precedence over .env until cleared or changed.\n` +
    `All new orders will reflect version <code>${version}</code>.`,
    { parse_mode: 'HTML' }
  );
}

/**
 * Handles /retrydelivery <ORDER_ID> command.
 *
 * @param {import('grammy').Context} ctx
 * @param {import('../services/deliveryService.js').DeliveryService} deliveryService
 */
export async function handleRetryDeliveryCommand(ctx, deliveryService) {
  const text = ctx.message?.text?.trim() || '';
  const parts = text.split(/\s+/);
  const orderId = parts[1];

  if (!orderId) {
    await ctx.reply('⚠️ Usage: <code>/retrydelivery &lt;ORDER_ID&gt;</code>', {
      parse_mode: 'HTML'
    });
    return;
  }

  await ctx.reply(`⏳ Attempting redelivery for order <code>${orderId}</code>...`, {
    parse_mode: 'HTML'
  });

  const result = await deliveryService.retryDelivery(ctx, orderId);
  await ctx.reply(result.message, { parse_mode: 'HTML' });
}

/**
 * Handles /export command.
 *
 * @param {import('grammy').Context} ctx
 * @param {import('../database/repositories.js').OrderRepository} orderRepo
 */
export async function handleExportCommand(ctx, orderRepo) {
  await ctx.reply('⏳ Generating orders CSV export...');

  try {
    const orders = await orderRepo.getAllOrdersForExport();
    const csvContent = ordersToCsv(orders);
    const filename = `orders_export_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;

    await ctx.replyWithDocument(new InputFile(Buffer.from(csvContent, 'utf-8'), filename), {
      caption: `📁 <b>Orders Export</b>\nTotal records exported: ${orders.length}`,
      parse_mode: 'HTML'
    });
  } catch (err) {
    logger.error({ error: err }, 'Failed to export orders to CSV');
    await ctx.reply('❌ Failed to generate CSV export.');
  }
}
