import { ethers } from "ethers"
import * as dotenv from "dotenv"
import chalk from "chalk"
import inquirer from "inquirer"
import TelegramBot from "node-telegram-bot-api"
import * as bip39 from "bip39"
import fs from "fs"
import crypto from "crypto"
import qrcodeLib from "qrcode"
import cron from "node-cron"
import gradient from "gradient-string"
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';

process.env.NTBA_FIX_319 = "1"

dotenv.config()

const RPC_URL = process.env.RPC_URL || "https://tea-sepolia.g.alchemy.com/public"
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || ""

const provider = new ethers.providers.JsonRpcProvider(RPC_URL)

let bot = null
if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
  bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false })
}

const teaGradient = gradient(["#00FFFF", "#00FF00", "#FFFF00"])
const menuGradient = gradient(["#FF00FF", "#00FFFF", "#FFFF00"])
const titleGradient = gradient(["#FF0000", "#FFFF00", "#00FF00", "#00FFFF", "#0000FF"])
const highlightGradient = gradient(["#FF00FF", "#FF0000", "#FFFF00"])

const banner = `
${chalk.green("╔═══════════════════════════════════════════════════════════════════════════════════════╗")}
${chalk.green("║")}                                                                                       ${chalk.green("║")}
${chalk.green("║")}  ${titleGradient("████████╗███████╗ █████╗    ██╗    ██╗ █████╗ ██╗     ██╗     ███████╗████████╗")}      ${chalk.green("║")}
${chalk.green("║")}  ${titleGradient("╚══██╔══╝██╔════╝██╔══██╗   ██║    ██║██╔══██╗██║     ██║     ██╔════╝╚══██╔══╝")}      ${chalk.green("║")}
${chalk.green("║")}  ${titleGradient("   ██║   █████╗  ███████║   ██║ █╗ ██║███████║██║     ██║     █████╗     ██║   ")}      ${chalk.green("║")}
${chalk.green("║")}  ${titleGradient("   ██║   ██╔══╝  ██╔══██║   ██║███╗██║██╔══██║██║     ██║     ██╔══╝     ██║   ")}      ${chalk.green("║")}
${chalk.green("║")}  ${titleGradient("   ██║   ███████╗██║  ██║   ╚███╔███╔╝██║  ██║███████╗███████╗███████╗   ██║   ")}      ${chalk.green("║")}
${chalk.green("║")}  ${titleGradient("   ╚═╝   ╚══════╝╚═╝  ╚═╝    ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝   ╚═╝   ")}      ${chalk.green("║")}
${chalk.green("║")}                                                                                       ${chalk.green("║")}
${chalk.green("║")}  ${teaGradient("Pengelola untuk Sepolia TEA Testnet")}                                                  ${chalk.green("║")}
${chalk.green("║")}  ${chalk.magenta("Dibuat oleh")} ${chalk.white("edosetiawan.eth")}                                                          ${chalk.green("║")}
${chalk.green("║")}  ${chalk.blue("Versi 2.1.7")}                                                                          ${chalk.green("║")}
${chalk.green("╚═══════════════════════════════════════════════════════════════════════════════════════╝")}
`

let wallets = []
const scheduledTasks = []
let walletGroups = {}
let walletStats = {}
let monitoringActive = false
const walletsFile = "wallets.json"
const statsFile = "wallet_stats.json"
const groupsFile = "wallet_groups.json"
const backupDir = "./backups"

function displayMenu(title, options) {
  const boxWidth = 60;
  const titleCentered = title.padEnd(boxWidth - 4);

  console.log(chalk.green("\n╔" + "═".repeat(boxWidth - 2) + "╗"));
  console.log(chalk.green(`║ ${titleCentered} ║`));
  console.log(chalk.green("╠" + "═".repeat(boxWidth - 2) + "╣"));

  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    const numStr = chalk.magenta((i + 1).toString().padStart(2, " "));
    
    const optionText = `${numStr}. ${option.name}`;
    
    const plainText = stripAnsi(`${(i + 1).toString().padStart(2, " ")}. ${option.name}`);
    
    let textWidth = stringWidth(plainText);
    
    const emojiMatches = plainText.match(/(\p{Emoji}\uFE0F|\p{Emoji})/gu) || [];
    
    for (const emoji of emojiMatches) {
      if (emoji.includes('\uFE0F')) {
        textWidth -= 1;
      }
    }
    
    const paddingSize = boxWidth - 4 - textWidth;
    const padding = " ".repeat(paddingSize > 0 ? paddingSize : 0);

    console.log(chalk.green(`║ ${optionText}${padding} ║`));
  }

  console.log(chalk.green("╚" + "═".repeat(boxWidth - 2) + "╝"));
  console.log(chalk.cyan("\nMasukkan nomor pilihan Anda: "));
}

function displayProgressBar(current, total, width = 50) {
  const percentage = Math.floor((current / total) * 100)
  const filledWidth = Math.floor((current / total) * width)
  const emptyWidth = width - filledWidth

  const filled = "█".repeat(filledWidth)
  const empty = "░".repeat(emptyWidth)

  let barColor
  if (percentage < 30) barColor = chalk.red
  else if (percentage < 70) barColor = chalk.yellow
  else barColor = chalk.green

  process.stdout.write(
    `\r${chalk.cyan("⟳")} Memeriksa saldo: [${barColor(filled + empty)}] ${barColor(percentage + "%")} (${current}/${total})`,
  )
}

async function getMenuChoice(options) {
  const { choice } = await inquirer.prompt([
    {
      type: "input",
      name: "choice",
      message: chalk.magenta("Masukkan nomor pilihan Anda:"),
      validate: (input) => {
        const num = Number.parseInt(input)
        if (isNaN(num) || num < 1 || num > options.length) {
          return `Silakan masukkan angka antara 1 dan ${options.length}`
        }
        return true
      },
    },
  ])

  return options[Number.parseInt(choice) - 1].value
}

function encrypt(data, password) {
  const algorithm = "aes-256-cbc"
  const key = crypto.scryptSync(password, "salt", 32)
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(algorithm, key, iv)
  let encrypted = cipher.update(JSON.stringify(data), "utf8", "hex")
  encrypted += cipher.final("hex")
  return { iv: iv.toString("hex"), encryptedData: encrypted }
}

function decrypt(encryptedData, iv, password) {
  try {
    const algorithm = "aes-256-cbc"
    const key = crypto.scryptSync(password, "salt", 32)
    const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(iv, "hex"))
    let decrypted = decipher.update(encryptedData, "hex", "utf8")
    decrypted += decipher.final("utf8")
    return JSON.parse(decrypted)
  } catch (error) {
    console.error(chalk.red("Error dekripsi:"), error.message)
    return null
  }
}

function loadWallets() {
  try {
    if (fs.existsSync(walletsFile)) {
      const data = fs.readFileSync(walletsFile, "utf8")
      wallets = JSON.parse(data)
      console.log(chalk.green(`✓ Memuat ${wallets.length} dompet yang ada`))
    }
  } catch (error) {
    console.error(chalk.red("Error memuat dompet:"), error.message)
  }
}

function saveWallets() {
  try {
    fs.writeFileSync(walletsFile, JSON.stringify(wallets, null, 2))
    console.log(chalk.green("✓ Dompet berhasil disimpan"))
  } catch (error) {
    console.error(chalk.red("Error menyimpan dompet:"), error.message)
  }
}

function loadWalletGroups() {
  try {
    if (fs.existsSync(groupsFile)) {
      const data = fs.readFileSync(groupsFile, "utf8")
      walletGroups = JSON.parse(data)
      console.log(chalk.green(`✓ Memuat ${Object.keys(walletGroups).length} grup dompet`))
    }
  } catch (error) {
    console.error(chalk.red("Error memuat grup dompet:"), error.message)
  }
}

function saveWalletGroups() {
  try {
    fs.writeFileSync(groupsFile, JSON.stringify(walletGroups, null, 2))
    console.log(chalk.green("✓ Grup dompet berhasil disimpan"))
  } catch (error) {
    console.error(chalk.red("Error menyimpan grup dompet:"), error.message)
  }
}

function loadWalletStats() {
  try {
    if (fs.existsSync(statsFile)) {
      const data = fs.readFileSync(statsFile, "utf8")
      walletStats = JSON.parse(data)
      console.log(chalk.green(`✓ Memuat statistik dompet`))
    }
  } catch (error) {
    console.error(chalk.red("Error memuat statistik dompet:"), error.message)
  }
}

function saveWalletStats() {
  try {
    fs.writeFileSync(statsFile, JSON.stringify(walletStats, null, 2))
    console.log(chalk.green("✓ Statistik dompet berhasil disimpan"))
  } catch (error) {
    console.error(chalk.red("Error menyimpan statistik dompet:"), error.message)
  }
}

function initializeStats(walletAddress) {
  if (!walletStats[walletAddress]) {
    walletStats[walletAddress] = {
      created: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      txCount: 0,
      txInCount: 0,
      txOutCount: 0,
      totalSent: "0",
      totalReceived: "0",
    }
    saveWalletStats()
  }
}

function updateWalletStats(walletAddress, type, amount = "0") {
  if (!walletStats[walletAddress]) {
    initializeStats(walletAddress)
  }

  walletStats[walletAddress].lastActive = new Date().toISOString()
  walletStats[walletAddress].txCount++

  if (type === "out") {
    walletStats[walletAddress].txOutCount++
    walletStats[walletAddress].totalSent = (
      Number.parseFloat(walletStats[walletAddress].totalSent) + Number.parseFloat(amount)
    ).toString()
  } else if (type === "in") {
    walletStats[walletAddress].txInCount++
    walletStats[walletAddress].totalReceived = (
      Number.parseFloat(walletStats[walletAddress].totalReceived) + Number.parseFloat(amount)
    ).toString()
  }

  saveWalletStats()
}

function generateWallet(customName = "") {
  const mnemonic = bip39.generateMnemonic()
  const wallet = ethers.Wallet.fromMnemonic(mnemonic)
  const connectedWallet = wallet.connect(provider)

  const walletObj = {
    name: customName || `Dompet ${wallets.length + 1}`,
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: mnemonic,
    balance: "0.0",
    group: "default",
  }

  initializeStats(wallet.address)
  return walletObj
}

async function importWalletFromPrivateKey(privateKey, customName = "") {
  try {
    const wallet = new ethers.Wallet(privateKey)
    const connectedWallet = wallet.connect(provider)

    const walletObj = {
      name: customName || `Dompet Impor ${wallets.length + 1}`,
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic: "",
      balance: "0.0",
      group: "default",
    }

    initializeStats(wallet.address)
    return walletObj
  } catch (error) {
    throw new Error(`Kunci privat tidak valid: ${error.message}`)
  }
}

async function importWalletFromMnemonic(mnemonic, customName = "") {
  try {
    const wallet = ethers.Wallet.fromMnemonic(mnemonic)
    const connectedWallet = wallet.connect(provider)

    const walletObj = {
      name: customName || `Dompet Impor ${wallets.length + 1}`,
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic: mnemonic,
      balance: "0.0",
      group: "default",
    }

    initializeStats(wallet.address)
    return walletObj
  } catch (error) {
    throw new Error(`Frasa mnemonik tidak valid: ${error.message}`)
  }
}

async function generateMultipleWallets(count, namePrefix = "Dompet", group = "default") {
  console.log(chalk.cyan(`\n⚡ Membuat ${count} dompet...`))

  const newWallets = []
  for (let i = 0; i < count; i++) {
    const walletName = `${namePrefix} ${wallets.length + i + 1}`
    const wallet = generateWallet(walletName)
    wallet.group = group
    newWallets.push(wallet)

    displayProgressBar(i + 1, count)
  }

  console.log("\n" + chalk.green("✓ Semua dompet berhasil dibuat!"))

  wallets = [...wallets, ...newWallets]
  saveWallets()

  return newWallets
}

async function checkBalance(walletAddress, retryCount = 5) {
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout saat memeriksa saldo")), 15000),
      )

      const balancePromise = provider.getBalance(walletAddress)

      const balance = await Promise.race([balancePromise, timeoutPromise])
      return ethers.utils.formatEther(balance)
    } catch (error) {
      console.log(chalk.yellow(`\nPercobaan ${attempt}/${retryCount} gagal: ${error.message}`))

      if (attempt === retryCount) {
        console.log(chalk.red(`\nGagal memeriksa saldo setelah ${retryCount} percobaan.`))
        return "0.0"
      }

      const waitTime = 1000 * Math.pow(2, attempt - 1)
      console.log(chalk.yellow(`Mencoba lagi dalam ${waitTime / 1000} detik...`))
      await new Promise((resolve) => setTimeout(resolve, waitTime))
    }
  }
  return "0.0"
}

async function updateAllBalances() {
  console.log(chalk.cyan("\n⚡ Memperbarui saldo untuk semua dompet..."))

  try {
    const batchSize = 5
    const results = []

    for (let i = 0; i < wallets.length; i += batchSize) {
      const batch = wallets.slice(i, Math.min(i + batchSize, wallets.length))

      const batchPromises = batch.map((wallet, batchIndex) => {
        return new Promise(async (resolve) => {
          try {
            await new Promise((r) => setTimeout(r, batchIndex * 100))

            const newBalance = await checkBalance(wallet.address)

            displayProgressBar(i + batchIndex + 1, wallets.length)

            resolve({ wallet, newBalance })
          } catch (err) {
            console.log(chalk.red(`\nError memeriksa saldo untuk ${wallet.name}: ${err.message}`))
            resolve({ wallet, newBalance: wallet.balance || "0.0" })
          }
        })
      })

      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)

      if (i + batchSize < wallets.length) {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }

    for (const { wallet, newBalance } of results) {
      if (wallet.balance !== newBalance && Number.parseFloat(wallet.balance) !== Number.parseFloat(newBalance)) {
        const oldBalance = wallet.balance
        wallet.balance = newBalance

        if (Number.parseFloat(newBalance) > Number.parseFloat(oldBalance)) {
          const received = Number.parseFloat(newBalance) - Number.parseFloat(oldBalance)
          updateWalletStats(wallet.address, "in", received.toString())

          if (monitoringActive && bot) {
            await sendBalanceAlertToTelegram(wallet, oldBalance, newBalance, received.toString(), "in")
          }
        }
      }
    }

    const filled = "█".repeat(50)
    process.stdout.write(
      `\r${chalk.cyan("⟳")} Memeriksa saldo: [${chalk.green(filled)}] ${chalk.green("100%")} (${wallets.length}/${wallets.length})`,
    )

    console.log("\n" + chalk.green("✓ Semua saldo diperbarui"))
    saveWallets()
  } catch (error) {
    console.error(chalk.red("\nError memperbarui saldo:"), error.message)
  }
}

async function sendTEA(fromWalletIndex, toAddress, amount) {
  try {
    if (fromWalletIndex < 0 || fromWalletIndex >= wallets.length) {
      throw new Error("Indeks dompet tidak valid")
    }

    const walletInfo = wallets[fromWalletIndex]
    const wallet = new ethers.Wallet(walletInfo.privateKey, provider)

    console.log(chalk.cyan(`\n⚡ Mengirim ${amount} TEA dari ${walletInfo.name} ke ${toAddress}...`))

    const tx = {
      to: toAddress,
      value: ethers.utils.parseEther(amount.toString()),
    }

    const transaction = await wallet.sendTransaction(tx)
    console.log(chalk.green(`✓ Transaksi terkirim! Hash: ${transaction.hash}`))

    console.log(chalk.cyan("⏳ Menunggu konfirmasi..."))
    await transaction.wait()
    console.log(chalk.green("✓ Transaksi dikonfirmasi!"))

    const oldBalance = walletInfo.balance
    walletInfo.balance = await checkBalance(walletInfo.address)
    updateWalletStats(walletInfo.address, "out", amount)
    saveWallets()

    if (bot) {
      const message = `
*🚀 Transaksi Berhasil* ✅

*📤 Dari:* ${walletInfo.name}
*📋 Alamat Pengirim:* 
\`${walletInfo.address}\`

*💰 Jumlah:* ${amount} TEA

*📥 Ke Alamat:* 
\`${toAddress}\`

*🔗 Hash Transaksi:* 
\`${transaction.hash}\`

*💼 Saldo Baru:* ${walletInfo.balance} TEA

*🔍 Lihat di Explorer:*
[Lihat di TEA Explorer](https://sepolia.tea.xyz/tx/${transaction.hash})

*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)
      `

      await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" })
    }

    return transaction.hash
  } catch (error) {
    console.error(chalk.red("Error mengirim TEA:"), error.message)
    throw error
  }
}

async function scheduleTransaction(fromWalletIndex, toAddress, amount, scheduledTime) {
  const walletInfo = wallets[fromWalletIndex]
  const taskId = `tx_${Date.now()}`

  const task = {
    id: taskId,
    fromWallet: fromWalletIndex,
    toAddress: toAddress,
    amount: amount,
    scheduledTime: scheduledTime,
    status: "scheduled",
  }

  scheduledTasks.push(task)
  fs.writeFileSync("scheduled_tasks.json", JSON.stringify(scheduledTasks, null, 2))

  const timeUntilExecution = new Date(scheduledTime) - new Date()

  if (timeUntilExecution > 0) {
    console.log(chalk.cyan(`\n⏰ Transaksi dijadwalkan untuk ${new Date(scheduledTime).toLocaleString()}`))

    if (bot) {
      const message = `
*⏰ Transaksi Terjadwal* 

*📤 Dari:* ${walletInfo.name}
*📋 Alamat Pengirim:* 
\`${walletInfo.address}\`

*💰 Jumlah:* ${amount} TEA

*📥 Ke Alamat:* 
\`${toAddress}\`

*🕒 Waktu Eksekusi:* ${new Date(scheduledTime).toLocaleString()}

*⏳ Waktu Tersisa:* ${Math.floor(timeUntilExecution / 60000)} menit

*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)
      `

      await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" })
    }

    setTimeout(async () => {
      try {
        console.log(chalk.cyan(`\n⚡ Menjalankan transaksi terjadwal ${taskId}...`))
        const txHash = await sendTEA(fromWalletIndex, toAddress, amount)

        const taskIndex = scheduledTasks.findIndex((t) => t.id === taskId)
        if (taskIndex !== -1) {
          scheduledTasks[taskIndex].status = "completed"
          scheduledTasks[taskIndex].txHash = txHash
          fs.writeFileSync("scheduled_tasks.json", JSON.stringify(scheduledTasks, null, 2))
        }
      } catch (error) {
        console.error(chalk.red(`Error menjalankan transaksi terjadwal ${taskId}:`), error.message)

        const taskIndex = scheduledTasks.findIndex((t) => t.id === taskId)
        if (taskIndex !== -1) {
          scheduledTasks[taskIndex].status = "failed"
          scheduledTasks[taskIndex].error = error.message
          fs.writeFileSync("scheduled_tasks.json", JSON.stringify(scheduledTasks, null, 2))
        }

        if (bot) {
          const message = `
*❌ Transaksi Terjadwal Gagal* 

*📤 Dari:* ${walletInfo.name}
*📋 Alamat Pengirim:* 
\`${walletInfo.address}\`

*💰 Jumlah:* ${amount} TEA

*📥 Ke Alamat:* 
\`${toAddress}\`

*❓ Alasan:* ${error.message}

*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)
          `

          await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" })
        }
      }
    }, timeUntilExecution)
  } else {
    console.log(chalk.red("Waktu yang dijadwalkan sudah lewat!"))
  }

  return taskId
}

async function sendFromMultipleWallets(walletIndices, toAddress, amountPerWallet) {
  console.log(chalk.cyan(`\n⚡ Mempersiapkan pengiriman dari ${walletIndices.length} dompet ke ${toAddress}...`))

  const results = []
  let successCount = 0
  let failCount = 0

  const transactions = []

  for (let i = 0; i < walletIndices.length; i++) {
    const index = walletIndices[i]
    displayProgressBar(i + 1, walletIndices.length)

    transactions.push(
      sendTEA(index, toAddress, amountPerWallet)
        .then((txHash) => {
          results.push({ wallet: wallets[index].name, success: true, txHash })
          successCount++
          return { success: true }
        })
        .catch((error) => {
          results.push({ wallet: wallets[index].name, success: false, error: error.message })
          failCount++
          return { success: false }
        }),
    )
  }

  await Promise.all(transactions)

  console.log("\n" + chalk.green(`✓ Selesai: ${successCount} berhasil, ${failCount} gagal`))

  if (bot) {
    const message = `
*📊 Ringkasan Transaksi Massal* 

*🔢 Total Dompet:* ${walletIndices.length}
*✅ Berhasil:* ${successCount}
*❌ Gagal:* ${failCount}

*📥 Alamat Tujuan:* 
\`${toAddress}\`

*💰 Jumlah per Dompet:* ${amountPerWallet} TEA
*💵 Total Terkirim:* ${successCount * amountPerWallet} TEA

*🔍 Lihat di Explorer:*
[TEA Explorer](https://sepolia.tea.xyz/address/${toAddress})

*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)
    `

    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" })
  }

  return results
}

async function sendWalletToTelegram(walletIndex) {
  if (!bot) {
    console.log(
      chalk.red("Bot Telegram tidak dikonfigurasi. Silakan atur TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID di file .env."),
    )
    return false
  }

  try {
    const wallet = wallets[walletIndex]
    const stats = walletStats[wallet.address] || { txCount: 0, txInCount: 0, txOutCount: 0, lastActive: "Tidak ada" }

    const message = `
*💼 ${wallet.name}*

*📋 Alamat:* 
\`${wallet.address}\`

*🔑 Kunci Privat:* 
\`${wallet.privateKey}\`

*🔐 Frasa Mnemonik:* 
\`${wallet.mnemonic}\`

*💰 Saldo:* ${wallet.balance} TEA

*📊 Statistik:*
• Grup: ${wallet.group || "default"}
• Total Transaksi: ${stats.txCount}
• Transaksi Masuk: ${stats.txInCount}
• Transaksi Keluar: ${stats.txOutCount}
• Terakhir Aktif: ${new Date(stats.lastActive).toLocaleString()}

*🔍 Lihat di Explorer:*
[Lihat di TEA Explorer](https://sepolia.tea.xyz/address/${wallet.address})

*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)
    `

    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" })

    console.log(chalk.green("\n✓ Detail dompet terkirim ke Telegram"))

    await generateAndSendQRCode(wallet.address)

    return true
  } catch (error) {
    console.error(chalk.red("Error mengirim ke Telegram:"), error.message)
    return false
  }
}

async function generateAndSendQRCode(address) {
  if (!bot) return

  return new Promise((resolve, reject) => {
    const tempFile = `./qrcode_${Date.now()}.png`

    qrcodeLib.toFile(
      tempFile,
      address,
      {
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      },
      async (err) => {
        if (err) {
          console.error(chalk.red("Error membuat QR code:"), err)
          reject(err)
          return
        }

        try {
          await bot.sendPhoto(TELEGRAM_CHAT_ID, tempFile, {
            caption: `*QR Code untuk alamat:*\n\`${address}\`\n\n*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)`,
            parse_mode: "Markdown",
          })

          fs.unlinkSync(tempFile)
          resolve()
        } catch (error) {
          console.error(chalk.red("Error mengirim QR code:"), error)
          reject(error)
        }
      },
    )
  })
}

async function sendAllWalletsToTelegram() {
  if (!bot) {
    console.log(
      chalk.red("Bot Telegram tidak dikonfigurasi. Silakan atur TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID di file .env."),
    )
    return false
  }

  try {
    let message = "*📋 Ringkasan Semua Dompet*\n\n"

    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i]
      message += `*${i + 1}. ${wallet.name}*\n`
      message += `*📋 Alamat:* \`${wallet.address}\`\n`
      message += `*💰 Saldo:* ${wallet.balance} TEA\n`
      message += `*👥 Grup:* ${wallet.group || "default"}\n`
      message += `*🔍 Explorer:* [Lihat](https://sepolia.tea.xyz/address/${wallet.address})\n\n`

      if ((i + 1) % 10 === 0 || i === wallets.length - 1) {
        message += `\n*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)`
        await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" })
        message = ""
      }

      displayProgressBar(i + 1, wallets.length)
    }

    console.log("\n" + chalk.green("✓ Ringkasan semua dompet terkirim ke Telegram"))
    return true
  } catch (error) {
    console.error(chalk.red("Error mengirim ke Telegram:"), error.message)
    return false
  }
}

async function sendBalanceAlertToTelegram(wallet, oldBalance, newBalance, amount, type) {
  if (!bot) return

  const typeText = type === "in" ? "Masuk" : "Keluar"
  const icon = type === "in" ? "📥" : "📤"

  const message = `
⚠️ *ALERT PERUBAHAN SALDO* ⚠️

💼 *Dompet:* ${wallet.name}
📋 *Alamat:* 
\`${wallet.address}\`

${icon} *Transaksi ${typeText} Terdeteksi!*
💰 *Jumlah:* ${type === "in" ? "+" : "-"}${amount} TEA
🕒 *Waktu:* ${new Date().toLocaleString()}

💼 *Saldo Sebelumnya:* ${oldBalance} TEA
💼 *Saldo Baru:* ${newBalance} TEA

🔍 *Lihat di Explorer:*
[Lihat di TEA Explorer](https://sepolia.tea.xyz/address/${wallet.address})

*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)
  `

  await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" })
}

function createWalletTextFile() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const fileName = `${backupDir}/wallet_info_${timestamp}.txt`

  let content = "📋 INFORMASI DOMPET TEA WALLET MANAGER 📋\n"
  content += "═════════════════════════════════════════\n\n"

  wallets.forEach((wallet, index) => {
    content += `🔹 DOMPET ${index + 1}: ${wallet.name} 🔹\n`
    content += "───────────────────────────────────\n"
    content += `📋 Alamat: ${wallet.address}\n`
    content += `🔑 Kunci Privat: ${wallet.privateKey}\n`
    if (wallet.mnemonic) {
      content += `🔐 Frasa Mnemonik: ${wallet.mnemonic}\n`
    }
    content += `💰 Saldo: ${wallet.balance} TEA\n`
    content += `👥 Grup: ${wallet.group || "default"}\n\n`
  })

  content += "TEA Wallet Manager | Hubungi Support: https://t.me/edosetiawan_eth\n"

  fs.writeFileSync(fileName, content)
  return fileName
}

async function backupWallets(password = null) {
  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir)
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupFileName = `${backupDir}/wallet_backup_${timestamp}.json`

    let backupData
    if (password) {
      backupData = encrypt(wallets, password)
      fs.writeFileSync(backupFileName, JSON.stringify(backupData, null, 2))
      console.log(chalk.green(`\n✓ Backup terenkripsi disimpan ke ${backupFileName}`))
    } else {
      fs.writeFileSync(backupFileName, JSON.stringify(wallets, null, 2))
      console.log(chalk.green(`\n✓ Backup disimpan ke ${backupFileName}`))
    }

    const textFileName = createWalletTextFile()

    if (bot) {
      const message = `
🔒 *BACKUP DOMPET BERHASIL* 🔒

📦 *Jumlah Dompet:* ${wallets.length}
🕒 *Waktu Backup:* ${new Date().toLocaleString()}

🔐 *Backup Terenkripsi:* ${password ? "Ya" : "Tidak"}

⚠️ *PENTING:* Simpan informasi dompet di tempat yang aman!

*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)
      `

      await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" })
    }

    return { jsonFile: backupFileName, textFile: textFileName }
  } catch (error) {
    console.error(chalk.red("Error membuat backup:"), error.message)
    throw error
  }
}

async function restoreWallets(backupFile, password = null) {
  try {
    const data = fs.readFileSync(backupFile, "utf8")
    let restoredWallets

    if (password) {
      const encryptedData = JSON.parse(data)
      restoredWallets = decrypt(encryptedData.encryptedData, encryptedData.iv, password)

      if (!restoredWallets) {
        throw new Error("Password salah atau file rusak")
      }
    } else {
      restoredWallets = JSON.parse(data)
    }

    wallets = restoredWallets
    saveWallets()

    console.log(chalk.green(`\n✓ ${wallets.length} dompet berhasil dipulihkan`))

    if (bot) {
      const message = `
🔄 *PEMULIHAN DOMPET BERHASIL* 🔄

📦 *Jumlah Dompet:* ${wallets.length}
🕒 *Waktu Pemulihan:* ${new Date().toLocaleString()}

*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)
      `

      await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" })
    }

    return true
  } catch (error) {
    console.error(chalk.red("Error memulihkan backup:"), error.message)
    throw error
  }
}

function displayWallets(group = null) {
  const boxWidth = 95; // Memperlebar box untuk alamat lengkap

  console.log(
    chalk.green("╔═════════════════════════════════════════════════════════════════════════════════════════════╗")
  );
  console.log(
    chalk.green("║                                     DAFTAR DOMPET ANDA                                      ║")
  );
  console.log(
    chalk.green("╠═════════════════════════════════════════════════════════════════════════════════════════════╣")
  );

  if (wallets.length === 0) {
    const message = "Tidak ada dompet ditemukan. Buat beberapa dompet terlebih dahulu.";
    console.log(chalk.green("║ ") + chalk.yellow(message.padEnd(boxWidth - 4)) + chalk.green(" ║"));
    console.log(
      chalk.green("╚═══════════════════════════════════════════════════════════════════════════════════════════════════╝")
    );
    return;
  }

  const filteredWallets = group ? wallets.filter((w) => w.group === group) : wallets;

  if (filteredWallets.length === 0) {
    const message = `Tidak ada dompet dalam grup "${group}"`;
    console.log(chalk.green("║ ") + chalk.yellow(message.padEnd(boxWidth - 4)) + chalk.green(" ║"));
    console.log(
      chalk.green("╚═════════════════════════════════════════════════════════════════════════════════════════════╝")
    );
    return;
  }

  if (group) {
    const groupMessage = `Menampilkan dompet dalam grup: ${group}`;
    console.log(chalk.green(`║ ${groupMessage.padEnd(boxWidth - 4)} ║`));
    console.log(
      chalk.green("╠═════════════════════════════════════════════════════════════════════════════════════════════╣")
    );
  }

  const headerText = "No  Nama                      Alamat                                                 Saldo";
  console.log(chalk.green("║ ") + chalk.magenta(headerText.padEnd(boxWidth - 4)) + chalk.green(" ║"));
  console.log(
    chalk.green("╠═════════════════════════════════════════════════════════════════════════════════════════════╣")
  );

  filteredWallets.forEach((wallet, index) => {
    const stats = walletStats[wallet.address] || { txCount: 0 };
    // Pastikan alamat tepat 45 karakter (jika lebih panjang akan dipotong)
    let formattedAddress = wallet.address;
    if (formattedAddress.length > 45) {
      formattedAddress = formattedAddress.substring(0, 45);
    }
    const line = `${(index + 1).toString().padStart(2)} ${wallet.name.padEnd(25)} ${formattedAddress.padEnd(45)} ${wallet.balance.padStart(8)} TEA`;
    console.log(chalk.green("║ ") + chalk.yellow(line.padEnd(boxWidth - 4)) + chalk.green(" ║"));
  });

  console.log(
    chalk.green("╚═════════════════════════════════════════════════════════════════════════════════════════════╝")
  );
}

async function startBalanceMonitoring() {
  if (monitoringActive) {
    console.log(chalk.yellow("Monitoring saldo sudah aktif!"))
    return
  }

  monitoringActive = true
  console.log(chalk.green("\n✓ Monitoring saldo diaktifkan"))

  if (bot) {
    await bot.sendMessage(
      TELEGRAM_CHAT_ID,
      `🔔 *Monitoring Saldo Diaktifkan*\n\nAnda akan menerima notifikasi saat ada perubahan saldo pada dompet.\n\n*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)`,
      { parse_mode: "Markdown" },
    )
  }

  const monitoringInterval = setInterval(async () => {
    if (!monitoringActive) {
      clearInterval(monitoringInterval)
      return
    }

    await updateAllBalances()
  }, 60000)
}

async function stopBalanceMonitoring() {
  monitoringActive = false
  console.log(chalk.yellow("\nMonitoring saldo dinonaktifkan"))

  if (bot) {
    await bot.sendMessage(
      TELEGRAM_CHAT_ID,
      `🔕 *Monitoring Saldo Dinonaktifkan*\n\n*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)`,
      { parse_mode: "Markdown" },
    )
  }
}

async function setupAutomaticBackup() {
  cron.schedule("0 0 * * *", async () => {
    console.log(chalk.yellow("Menjalankan backup otomatis harian..."))
    try {
      const backupFiles = await backupWallets()

      if (bot) {
        const message = `
🔄 *BACKUP OTOMATIS HARIAN* 🔄

📦 *Jumlah Dompet:* ${wallets.length}
🕒 *Waktu:* ${new Date().toLocaleString()}
📁 *File:* ${backupFiles.jsonFile}

*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)
        `

        await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" })
      }
    } catch (error) {
      console.error(chalk.red("Error backup otomatis:"), error.message)
    }
  })

  console.log(chalk.green("✓ Backup otomatis harian diatur"))
}

async function sendDailyReport() {
  if (!bot) return

  try {
    await updateAllBalances()

    let totalBalance = 0
    let totalTx = 0
    let todayTx = 0

    const today = new Date().toISOString().split("T")[0]

    wallets.forEach((wallet) => {
      totalBalance += Number.parseFloat(wallet.balance)

      const stats = walletStats[wallet.address]
      if (stats) {
        totalTx += stats.txCount

        if (stats.lastActive && stats.lastActive.startsWith(today)) {
          todayTx++
        }
      }
    })

    const sortedWallets = [...wallets].sort((a, b) => Number.parseFloat(b.balance) - Number.parseFloat(a.balance))
    const top5Wallets = sortedWallets.slice(0, 5)

    let top5Text = ""
    top5Wallets.forEach((wallet, index) => {
      top5Text += `${index + 1}. *${wallet.name}:* ${wallet.balance} TEA\n`
    })

    const message = `
📊 *LAPORAN HARIAN DOMPET* 📊
📅 *Tanggal:* ${new Date().toLocaleDateString()}

*Ringkasan:*
• Total Dompet: ${wallets.length}
• Total Saldo: ${totalBalance.toFixed(4)} TEA
• Total Transaksi: ${totalTx}
• Transaksi Hari Ini: ${todayTx}

*Top 5 Dompet:*
${top5Text}

*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)
    `

    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" })
    console.log(chalk.green("\n✓ Laporan harian terkirim ke Telegram"))
  } catch (error) {
    console.error(chalk.red("Error mengirim laporan harian:"), error.message)
  }
}

async function setupDailyReport() {
  cron.schedule("0 8 * * *", async () => {
    console.log(chalk.yellow("Mengirim laporan harian..."))
    await sendDailyReport()
  })

  console.log(chalk.green("✓ Laporan harian diatur"))
}

function deleteWallet(index) {
  if (index < 0 || index >= wallets.length) {
    throw new Error("Indeks dompet tidak valid")
  }

  const deletedWallet = wallets[index]
  wallets.splice(index, 1)
  saveWallets()

  return deletedWallet
}

function deleteAllWallets() {
  const count = wallets.length
  wallets = []
  saveWallets()
  return count
}

async function deleteWalletMenu() {
  if (wallets.length === 0) {
    console.log(chalk.yellow("\nTidak ada dompet ditemukan. Buat beberapa dompet terlebih dahulu."))
    return
  }

  const options = [
    { name: "🗑️ Hapus Satu Dompet", value: "single" },
    { name: "🗑️ Hapus Beberapa Dompet", value: "multiple" },
    { name: "⚠️ Hapus Semua Dompet", value: "all" },
    { name: "↩️ Kembali ke Menu Utama", value: "back" },
  ]

  displayMenu("MENU HAPUS DOMPET", options)
  const deleteType = await getMenuChoice(options)

  if (deleteType === "back") return

  if (deleteType === "single") {
    const walletOptions = wallets.map((w, i) => ({
      name: `${w.name} - ${w.balance} TEA (${w.address.substring(0, 8)}...)`,
      value: i,
    }))

    displayMenu("PILIH DOMPET UNTUK DIHAPUS", walletOptions)
    const walletIndex = await getMenuChoice(walletOptions)

    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: chalk.magenta("Anda yakin ingin menghapus dompet ini? Tindakan ini tidak dapat dibatalkan!"),
        default: false,
      },
    ])

    if (confirm) {
      try {
        const deletedWallet = deleteWallet(walletIndex)
        console.log(chalk.green(`\n✓ Dompet "${deletedWallet.name}" berhasil dihapus`))

        if (bot) {
          const message = `
🗑️ *DOMPET DIHAPUS* 🗑️

*Nama:* ${deletedWallet.name}
*Alamat:* \`${deletedWallet.address}\`
*Waktu:* ${new Date().toLocaleString()}

*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)
          `

          await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" })
        }
      } catch (error) {
        console.error(chalk.red("Error menghapus dompet:"), error.message)
      }
    } else {
      console.log(chalk.yellow("\nPenghapusan dibatalkan."))
    }
  } else if (deleteType === "multiple") {
    const { selectedWallets } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "selectedWallets",
        message: chalk.magenta("Pilih dompet yang akan dihapus (gunakan spasi untuk memilih, enter untuk konfirmasi):"),
        choices: wallets.map((w, i) => ({
          name: `${w.name} - ${w.balance} TEA (${w.address.substring(0, 8)}...)`,
          value: i,
        })),
        validate: (value) => (value.length > 0 ? true : "Silakan pilih setidaknya satu dompet"),
      },
    ])

    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: chalk.magenta(
          `Anda yakin ingin menghapus ${selectedWallets.length} dompet? Tindakan ini tidak dapat dibatalkan!`,
        ),
        default: false,
      },
    ])

    if (confirm) {
      try {
        const sortedIndices = [...selectedWallets].sort((a, b) => b - a)
        const deletedWallets = []

        for (const index of sortedIndices) {
          deletedWallets.push(wallets[index])
          wallets.splice(index, 1)
        }

        saveWallets()
        console.log(chalk.green(`\n✓ ${deletedWallets.length} dompet berhasil dihapus`))

        if (bot) {
          const message = `
🗑️ *BEBERAPA DOMPET DIHAPUS* 🗑️

*Jumlah:* ${deletedWallets.length} dompet
*Waktu:* ${new Date().toLocaleString()}

*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)
          `

          await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" })
        }
      } catch (error) {
        console.error(chalk.red("Error menghapus dompet:"), error.message)
      }
    } else {
      console.log(chalk.yellow("\nPenghapusan dibatalkan."))
    }
  } else if (deleteType === "all") {
    const { confirmAll, confirmAgain } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmAll",
        message: chalk.magenta(
          `⚠️ PERINGATAN: Anda akan menghapus SEMUA dompet (${wallets.length} dompet). Tindakan ini tidak dapat dibatalkan!`,
        ),
        default: false,
      },
      {
        type: "input",
        name: "confirmAgain",
        message: chalk.magenta('Ketik "HAPUS SEMUA" untuk mengkonfirmasi:'),
        when: (answers) => answers.confirmAll,
        validate: (value) => (value === "HAPUS SEMUA" ? true : 'Masukkan "HAPUS SEMUA" untuk melanjutkan'),
      },
    ])

    if (confirmAll && confirmAgain) {
      try {
        const backupFiles = await backupWallets()
        console.log(chalk.yellow(`\nBackup dibuat di ${backupFiles.jsonFile} sebelum penghapusan`))

        const count = deleteAllWallets()
        console.log(chalk.green(`\n✓ ${count} dompet berhasil dihapus`))

        if (bot) {
          const message = `
⚠️ *SEMUA DOMPET DIHAPUS* ⚠️

*Jumlah:* ${count} dompet
*Waktu:* ${new Date().toLocaleString()}
*Backup:* Dibuat sebelum penghapusan

*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)
          `

          await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" })
        }
      } catch (error) {
        console.error(chalk.red("Error menghapus semua dompet:"), error.message)
      }
    } else {
      console.log(chalk.yellow("\nPenghapusan dibatalkan."))
    }
  }
}

async function checkBalanceMenu() {
  if (wallets.length === 0) {
    console.log(chalk.yellow("\nTidak ada dompet ditemukan. Buat beberapa dompet terlebih dahulu."))
    return
  }

  const options = [
    { name: "💰 Semua dompet", value: "all" },
    { name: "💰 Dompet tertentu", value: "specific" },
    { name: "💰 Dompet dalam grup", value: "group" },
    { name: "↩️ Kembali ke Menu Utama", value: "back" },
  ]

  displayMenu("MENU PERIKSA SALDO", options)
  const action = await getMenuChoice(options)

  if (action === "back") return

  if (action === "all") {
    await updateAllBalances()
    displayWallets()
  } else if (action === "specific") {
    const walletOptions = wallets.map((w, i) => ({
      name: `${w.name} (${w.address.substring(0, 8)}...)`,
      value: i,
    }))

    displayMenu("PILIH DOMPET", walletOptions)
    const walletIndex = await getMenuChoice(walletOptions)

    const wallet = wallets[walletIndex]
    console.log(chalk.cyan("\n⚡ Memeriksa saldo dompet..."))

    let progress = 0
    const loadingInterval = setInterval(() => {
      progress = Math.min(progress + 5, 95)
      const filledWidth = Math.floor((progress / 100) * 50)
      const emptyWidth = 50 - filledWidth

      let barColor
      if (progress < 30) barColor = chalk.red
      else if (progress < 70) barColor = chalk.yellow
      else barColor = chalk.green

      const filled = "█".repeat(filledWidth)
      const empty = "░".repeat(emptyWidth)

      process.stdout.write(
        `\r${chalk.cyan("⟳")} Memeriksa saldo: [${barColor(filled + empty)}] ${barColor(progress + "%")}`,
      )
    }, 100)

    const balance = await checkBalance(wallet.address)
    clearInterval(loadingInterval)

    const filled = "█".repeat(50)
    process.stdout.write(`\r${chalk.cyan("⟳")} Memeriksa saldo: [${chalk.green(filled)}] ${chalk.green("100%")}`)

    wallet.balance = balance
    saveWallets()

    const boxWidth = 85
    console.log(
      "\n" +
        chalk.green(
          "\n╔═════════════════════════════════════════════════════════════════════════════════════════════╗",
        ),
    )
    const titleText = `Saldo untuk ${wallet.name}`
    console.log(chalk.green(`║ ${titleText.padEnd(boxWidth - 4)} ║`))
    console.log(
      chalk.green("╠═════════════════════════════════════════════════════════════════════════════════════════════╣"),
    )
    const balanceText = `${balance} TEA`
    console.log(chalk.green(`║ ${chalk.green(balanceText).padEnd(boxWidth - 4)} ║`))
    console.log(
      chalk.green("╚═════════════════════════════════════════════════════════════════════════════════════════════╝"),
    )
  } else if (action === "group") {
    const groups = [...new Set(wallets.map((w) => w.group || "default"))]
    const groupOptions = groups.map((g) => ({ name: g, value: g }))

    displayMenu("PILIH GRUP", groupOptions)
    const group = await getMenuChoice(groupOptions)

    const groupWallets = wallets.filter((w) => (w.group || "default") === group)

    console.log(chalk.cyan(`\n⚡ Memperbarui saldo untuk ${groupWallets.length} dompet dalam grup "${group}"...`))

    const batchSize = 5
    const results = []

    for (let i = 0; i < groupWallets.length; i += batchSize) {
      const batch = groupWallets.slice(i, Math.min(i + batchSize, groupWallets.length))

      const batchPromises = batch.map((wallet, batchIndex) => {
        return new Promise(async (resolve) => {
          try {
            await new Promise((r) => setTimeout(r, batchIndex * 100))

            const newBalance = await checkBalance(wallet.address)

            displayProgressBar(i + batchIndex + 1, groupWallets.length)

            resolve({ wallet, newBalance })
          } catch (err) {
            console.log(chalk.red(`\nError memeriksa saldo untuk ${wallet.name}: ${err.message}`))
            resolve({ wallet, newBalance: wallet.balance || "0.0" })
          }
        })
      })

      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)

      if (i + batchSize < groupWallets.length) {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }

    for (const { wallet, newBalance } of results) {
      wallet.balance = newBalance
    }

    const filled = "█".repeat(50)
    process.stdout.write(
      `\r${chalk.cyan("⟳")} Memeriksa saldo: [${chalk.green(filled)}] ${chalk.green("100%")} (${groupWallets.length}/${groupWallets.length})`,
    )

    console.log("\n" + chalk.green("✓ Semua saldo diperbarui"))
    saveWallets()

    displayWallets(group)
  }
}

async function sendWalletInfoToTelegram() {
  if (!bot) {
    console.log(
      chalk.red("Bot Telegram tidak dikonfigurasi. Silakan atur TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID di file .env."),
    )
    return false
  }

  try {
    let summaryMessage = "*📋 RINGKASAN DOMPET TEA WALLET MANAGER 📋*\n\n"
    summaryMessage += `*Total Dompet:* ${wallets.length}\n`
    summaryMessage += `*Waktu Backup:* ${new Date().toLocaleString()}\n\n`

    await bot.sendMessage(TELEGRAM_CHAT_ID, summaryMessage, { parse_mode: "Markdown" })

    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i]
      const walletMessage = `
*💼 DOMPET ${i + 1}: ${wallet.name}*

*📋 Alamat:* 
\`${wallet.address}\`

*🔑 Kunci Privat:* 
\`${wallet.privateKey}\`

${
  wallet.mnemonic
    ? `*🔐 Frasa Mnemonik:* 
\`${wallet.mnemonic}\`

`
    : ""
}*💰 Saldo:* ${wallet.balance} TEA
*👥 Grup:* ${wallet.group || "default"}

*🔍 Explorer:* [Lihat di TEA Explorer](https://sepolia.tea.xyz/address/${wallet.address})

*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)
      `

      await bot.sendMessage(TELEGRAM_CHAT_ID, walletMessage, { parse_mode: "Markdown" })

      await new Promise((resolve) => setTimeout(resolve, 100))

      displayProgressBar(i + 1, wallets.length)
    }

    const textFileName = createWalletTextFile()
    await bot.sendDocument(TELEGRAM_CHAT_ID, textFileName, {
      caption: `📄 Informasi lengkap dompet (${wallets.length} dompet) - ${new Date().toLocaleString()}\n\n*TEA Wallet Manager* | [Hubungi Support](https://t.me/edosetiawan_eth)`,
      parse_mode: "Markdown",
    })

    console.log("\n" + chalk.green("✓ Informasi dompet berhasil dikirim ke Telegram"))
    return true
  } catch (error) {
    console.error(chalk.red("Error mengirim informasi dompet ke Telegram:"), error.message)
    return false
  }
}

async function backupMenu() {
  const options = [
    { name: "💾 Backup Dompet", value: "backup" },
    { name: "🔄 Restore Dompet", value: "restore" },
    { name: "🔒 Backup Terenkripsi", value: "encrypted_backup" },
    { name: "🔓 Restore Terenkripsi", value: "encrypted_restore" },
    { name: "📱 Kirim Info Dompet ke Telegram", value: "telegram_backup" },
    { name: "↩️ Kembali ke Menu Utama", value: "back" },
  ]

  displayMenu("MENU BACKUP & RESTORE", options)
  const action = await getMenuChoice(options)

  if (action === "back") return

  if (action === "backup") {
    try {
      const backupFiles = await backupWallets()
      console.log(chalk.green(`\n✓ Backup berhasil disimpan ke ${backupFiles.jsonFile}`))
      console.log(chalk.green(`✓ Informasi dompet disimpan ke ${backupFiles.textFile}`))

      console.log(chalk.yellow("\n⚠️ PERINGATAN: Simpan file backup di tempat yang aman!"))
      console.log(chalk.yellow("⚠️ Jangan bagikan file backup dengan orang lain!"))
    } catch (error) {
      console.error(chalk.red("Backup gagal:"), error.message)
    }
  } else if (action === "restore") {
    if (!fs.existsSync(backupDir)) {
      console.log(chalk.yellow("\nDirektori backup tidak ditemukan."))
      return
    }

    const backupFiles = fs.readdirSync(backupDir).filter((f) => f.endsWith(".json"))

    if (backupFiles.length === 0) {
      console.log(chalk.yellow("\nTidak ada file backup ditemukan."))
      return
    }

    const backupOptions = backupFiles.map((f) => ({ name: f, value: f }))

    displayMenu("PILIH FILE BACKUP", backupOptions)
    const backupFile = await getMenuChoice(backupOptions)

    try {
      await restoreWallets(`${backupDir}/${backupFile}`)
    } catch (error) {
      console.error(chalk.red("Restore gagal:"), error.message)
    }
  } else if (action === "encrypted_backup") {
    const { password } = await inquirer.prompt([
      {
        type: "password",
        name: "password",
        message: chalk.magenta("Masukkan password untuk enkripsi:"),
        validate: (value) => (value.length >= 8 ? true : "Password harus minimal 8 karakter"),
      },
    ])

    try {
      const backupFiles = await backupWallets(password)
      console.log(chalk.green(`\n✓ Backup terenkripsi berhasil disimpan ke ${backupFiles.jsonFile}`))
      console.log(chalk.green(`✓ Informasi dompet disimpan ke ${backupFiles.textFile}`))

      console.log(chalk.yellow("\n⚠️ PERINGATAN: Simpan file backup dan password di tempat yang aman!"))
      console.log(chalk.yellow("⚠️ Jangan bagikan file backup dan password dengan orang lain!"))
    } catch (error) {
      console.error(chalk.red("Backup gagal:"), error.message)
    }
  } else if (action === "encrypted_restore") {
    if (!fs.existsSync(backupDir)) {
      console.log(chalk.yellow("\nDirektori backup tidak ditemukan."))
      return
    }

    const backupFiles = fs.readdirSync(backupDir).filter((f) => f.endsWith(".json"))

    if (backupFiles.length === 0) {
      console.log(chalk.yellow("\nTidak ada file backup ditemukan."))
      return
    }

    const backupOptions = backupFiles.map((f) => ({ name: f, value: f }))

    displayMenu("PILIH FILE BACKUP", backupOptions)
    const backupFile = await getMenuChoice(backupOptions)

    const { password } = await inquirer.prompt([
      {
        type: "password",
        name: "password",
        message: chalk.magenta("Masukkan password untuk dekripsi:"),
      },
    ])

    try {
      await restoreWallets(`${backupDir}/${backupFile}`, password)
    } catch (error) {
      console.error(chalk.red("Restore gagal:"), error.message)
    }
  } else if (action === "telegram_backup") {
    if (!bot) {
      console.log(
        chalk.red(
          "\nBot Telegram tidak dikonfigurasi. Silakan atur TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID di file .env.",
        ),
      )
      return
    }

    try {
      await sendWalletInfoToTelegram()
      console.log(chalk.green("\n✓ Informasi dompet berhasil dikirim ke Telegram"))
    } catch (error) {
      console.error(chalk.red("Gagal mengirim informasi dompet:"), error.message)
    }
  }
}

async function mainMenu() {
  console.clear()
  console.log(banner)

  const options = [
    { name: "🔑 Buat Dompet Baru", value: "generate" },
    { name: "🔢 Buat Beberapa Dompet", value: "generate_multiple" },
    { name: "📥 Impor Dompet", value: "import" },
    { name: "💰 Periksa Saldo", value: "check_balance" },
    { name: "📤 Kirim TEA", value: "send" },
    { name: "⏰ Jadwalkan Transaksi", value: "schedule" },
    { name: "📤 Kirim TEA dari Beberapa Dompet", value: "send_multiple" },
    { name: "👥 Kelola Grup Dompet", value: "manage_groups" },
    { name: "📱 Kirim Detail Dompet ke Telegram", value: "telegram_single" },
    { name: "📱 Kirim Semua Dompet ke Telegram", value: "telegram_all" },
    { name: "📋 Tampilkan Dompet", value: "display" },
    { name: "🔍 Cari Dompet", value: "search" },
    { name: "📊 Statistik Dompet", value: "stats" },
    { name: "🔔 Monitoring Saldo", value: "monitoring" },
    { name: "💾 Backup & Restore", value: "backup" },
    { name: "📊 Laporan Harian", value: "report" },
    { name: "🗑️ Hapus Dompet", value: "delete" },
    { name: "❌ Keluar", value: "exit" },
  ]

  displayMenu("MENU UTAMA TEA WALLET MANAGER", options)
  const action = await getMenuChoice(options)

  async function generateWalletMenu() {
    const { customName } = await inquirer.prompt([
      {
        type: "input",
        name: "customName",
        message: chalk.magenta("Masukkan nama dompet (opsional):"),
      },
    ])

    const wallet = generateWallet(customName)
    wallets.push(wallet)
    saveWallets()

    console.log(chalk.green(`\n✓ Dompet "${wallet.name}" berhasil dibuat dengan alamat ${wallet.address}`))
  }

  async function generateMultipleWalletsMenu() {
    const { count, namePrefix, group } = await inquirer.prompt([
      {
        type: "input",
        name: "count",
        message: chalk.magenta("Jumlah dompet yang ingin dibuat:"),
        validate: (value) => {
          const num = Number.parseInt(value)
          if (isNaN(num) || num <= 0) {
            return "Silakan masukkan angka yang valid lebih besar dari 0"
          }
          return true
        },
      },
      {
        type: "input",
        name: "namePrefix",
        message: chalk.magenta("Awalan nama dompet (opsional):"),
        default: "Dompet",
      },
      {
        type: "input",
        name: "group",
        message: chalk.magenta("Nama grup dompet (opsional, default: default):"),
        default: "default",
      },
    ])

    await generateMultipleWallets(Number.parseInt(count), namePrefix, group)
  }

  async function importWalletMenu() {
    const options = [
      { name: "🔑 Kunci Privat", value: "privateKey" },
      { name: "🔐 Frasa Mnemonik", value: "mnemonic" },
      { name: "↩️ Kembali ke Menu Utama", value: "back" },
    ]

    displayMenu("PILIH METODE IMPOR", options)
    const importType = await getMenuChoice(options)

    if (importType === "back") return

    if (importType === "privateKey") {
      const { privateKey, customName } = await inquirer.prompt([
        {
          type: "input",
          name: "privateKey",
          message: chalk.magenta("Masukkan kunci privat:"),
          validate: (value) => (value.length > 0 ? true : "Kunci privat tidak boleh kosong"),
        },
        {
          type: "input",
          name: "customName",
          message: chalk.magenta("Masukkan nama dompet (opsional):"),
        },
      ])

      try {
        const wallet = await importWalletFromPrivateKey(privateKey, customName)
        wallets.push(wallet)
        saveWallets()
        console.log(chalk.green(`\n✓ Dompet "${wallet.name}" berhasil diimpor dengan alamat ${wallet.address}`))
      } catch (error) {
        console.error(chalk.red("Error mengimpor dompet:"), error.message)
      }
    } else if (importType === "mnemonic") {
      const { mnemonic, customName } = await inquirer.prompt([
        {
          type: "input",
          name: "mnemonic",
          message: chalk.magenta("Masukkan frasa mnemonik:"),
          validate: (value) => (value.length > 0 ? true : "Frasa mnemonik tidak boleh kosong"),
        },
        {
          type: "input",
          name: "customName",
          message: chalk.magenta("Masukkan nama dompet (opsional):"),
        },
      ])

      try {
        const wallet = await importWalletFromMnemonic(mnemonic, customName)
        wallets.push(wallet)
        saveWallets()
        console.log(chalk.green(`\n✓ Dompet "${wallet.name}" berhasil diimpor dengan alamat ${wallet.address}`))
      } catch (error) {
        console.error(chalk.red("Error mengimpor dompet:"), error.message)
      }
    }
  }

  async function sendTEAMenu() {
    if (wallets.length === 0) {
      console.log(chalk.yellow("\nTidak ada dompet ditemukan. Buat beberapa dompet terlebih dahulu."))
      return
    }

    const walletOptions = wallets.map((w, i) => ({
      name: `${w.name} - ${w.balance} TEA (${w.address.substring(0, 8)}...)`,
      value: i,
    }))

    displayMenu("PILIH DOMPET PENGIRIM", walletOptions)
    const fromWalletIndex = await getMenuChoice(walletOptions)

    const { toAddress, amount } = await inquirer.prompt([
      {
        type: "input",
        name: "toAddress",
        message: chalk.magenta("Masukkan alamat penerima:"),
        validate: (value) => (ethers.utils.isAddress(value) ? true : "Alamat tidak valid"),
      },
      {
        type: "input",
        name: "amount",
        message: chalk.magenta("Masukkan jumlah TEA yang ingin dikirim:"),
        validate: (value) => {
          const num = Number.parseFloat(value)
          if (isNaN(num) || num <= 0) {
            return "Silakan masukkan angka yang valid lebih besar dari 0"
          }
          return true
        },
      },
    ])

    try {
      await sendTEA(fromWalletIndex, toAddress, Number.parseFloat(amount))
    } catch (error) {
      console.error(chalk.red("Error mengirim TEA:"), error.message)
    }
  }

  async function scheduleTransactionMenu() {
    if (wallets.length === 0) {
      console.log(chalk.yellow("\nTidak ada dompet ditemukan. Buat beberapa dompet terlebih dahulu."))
      return
    }

    const walletOptions = wallets.map((w, i) => ({
      name: `${w.name} - ${w.balance} TEA (${w.address.substring(0, 8)}...)`,
      value: i,
    }))

    displayMenu("PILIH DOMPET PENGIRIM", walletOptions)
    const fromWalletIndex = await getMenuChoice(walletOptions)

    const { toAddress, amount, scheduledTime } = await inquirer.prompt([
      {
        type: "input",
        name: "toAddress",
        message: chalk.magenta("Masukkan alamat penerima:"),
        validate: (value) => (ethers.utils.isAddress(value) ? true : "Alamat tidak valid"),
      },
      {
        type: "input",
        name: "amount",
        message: chalk.magenta("Masukkan jumlah TEA yang ingin dikirim:"),
        validate: (value) => {
          const num = Number.parseFloat(value)
          if (isNaN(num) || num <= 0) {
            return "Silakan masukkan angka yang valid lebih besar dari 0"
          }
          return true
        },
      },
      {
        type: "datetime",
        name: "scheduledTime",
        message: chalk.magenta("Masukkan waktu penjadwalan (YYYY-MM-DD HH:mm):"),
        default: () => {
          const now = new Date()
          now.setMinutes(now.getMinutes() + 5)
          return now.toISOString().slice(0, 16)
        },
        validate: (value) => {
          if (isNaN(new Date(value).getTime())) {
            return "Format waktu tidak valid. Gunakan YYYY-MM-DD HH:mm"
          }
          return true
        },
      },
    ])

    try {
      await scheduleTransaction(fromWalletIndex, toAddress, Number.parseFloat(amount), scheduledTime)
    } catch (error) {
      console.error(chalk.red("Error menjadwalkan transaksi:"), error.message)
    }
  }

  async function sendMultipleMenu() {
    if (wallets.length === 0) {
      console.log(chalk.yellow("\nTidak ada dompet ditemukan. Buat beberapa dompet terlebih dahulu."))
      return
    }

    const { selectedWallets, toAddress, amountPerWallet } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "selectedWallets",
        message: chalk.magenta("Pilih dompet pengirim (gunakan spasi untuk memilih, enter untuk konfirmasi):"),
        choices: wallets.map((w, i) => ({
          name: `${w.name} - ${w.balance} TEA (${w.address.substring(0, 8)}...)`,
          value: i,
        })),
        validate: (value) => (value.length > 0 ? true : "Silakan pilih setidaknya satu dompet"),
      },
      {
        type: "input",
        name: "toAddress",
        message: chalk.magenta("Masukkan alamat penerima:"),
        validate: (value) => (ethers.utils.isAddress(value) ? true : "Alamat tidak valid"),
      },
      {
        type: "input",
        name: "amountPerWallet",
        message: chalk.magenta("Masukkan jumlah TEA per dompet:"),
        validate: (value) => {
          const num = Number.parseFloat(value)
          if (isNaN(num) || num <= 0) {
            return "Silakan masukkan angka yang valid lebih besar dari 0"
          }
          return true
        },
      },
    ])

    try {
      await sendFromMultipleWallets(selectedWallets, toAddress, Number.parseFloat(amountPerWallet))
    } catch (error) {
      console.error(chalk.red("Error mengirim dari beberapa dompet:"), error.message)
    }
  }

  async function manageGroupsMenu() {
    const options = [
      { name: "➕ Buat Grup Baru", value: "create" },
      { name: "✏️ Edit Nama Grup", value: "edit" },
      { name: "🗑️ Hapus Grup", value: "delete" },
      { name: "➕ Tambah Dompet ke Grup", value: "add_wallet" },
      { name: "➖ Hapus Dompet dari Grup", value: "remove_wallet" },
      { name: "📋 Tampilkan Dompet dalam Grup", value: "display_group" },
      { name: "↩️ Kembali ke Menu Utama", value: "back" },
    ]

    displayMenu("MENU KELOLA GRUP DOMPET", options)
    const action = await getMenuChoice(options)

    if (action === "back") return

    if (action === "create") {
      const { groupName } = await inquirer.prompt([
        {
          type: "input",
          name: "groupName",
          message: chalk.magenta("Masukkan nama grup baru:"),
          validate: (value) => (value.length > 0 ? true : "Nama grup tidak boleh kosong"),
        },
      ])

      walletGroups[groupName] = []
      saveWalletGroups()
      console.log(chalk.green(`\n✓ Grup "${groupName}" berhasil dibuat`))
    } else if (action === "edit") {
      const groupOptions = Object.keys(walletGroups).map((g) => ({ name: g, value: g }))

      displayMenu("PILIH GRUP UNTUK DIEDIT", groupOptions)
      const groupToEdit = await getMenuChoice(groupOptions)

      const { newGroupName } = await inquirer.prompt([
        {
          type: "input",
          name: "newGroupName",
          message: chalk.magenta("Masukkan nama grup baru:"),
          validate: (value) => (value.length > 0 ? true : "Nama grup tidak boleh kosong"),
          default: groupToEdit,
        },
      ])

      walletGroups[newGroupName] = walletGroups[groupToEdit]
      delete walletGroups[groupToEdit]

      wallets.forEach((wallet) => {
        if (wallet.group === groupToEdit) {
          wallet.group = newGroupName
        }
      })

      saveWalletGroups()
      saveWallets()
      console.log(chalk.green(`\n✓ Grup "${groupToEdit}" berhasil diubah namanya menjadi "${newGroupName}"`))
    } else if (action === "delete") {
      const groupOptions = Object.keys(walletGroups).map((g) => ({ name: g, value: g }))

      displayMenu("PILIH GRUP UNTUK DIHAPUS", groupOptions)
      const groupToDelete = await getMenuChoice(groupOptions)

      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: chalk.magenta(`Anda yakin ingin menghapus grup "${groupToDelete}"?`),
          default: false,
        },
      ])

      if (confirm) {
        delete walletGroups[groupToDelete]

        wallets.forEach((wallet) => {
          if (wallet.group === groupToDelete) {
            wallet.group = "default"
          }
        })

        saveWalletGroups()
        saveWallets()
        console.log(chalk.green(`\n✓ Grup "${groupToDelete}" berhasil dihapus`))
      } else {
        console.log(chalk.yellow("\nPenghapusan dibatalkan."))
      }
    } else if (action === "add_wallet") {
      const groupOptions = Object.keys(walletGroups).map((g) => ({ name: g, value: g }))

      displayMenu("PILIH GRUP", groupOptions)
      const groupToAdd = await getMenuChoice(groupOptions)

      const walletOptions = wallets
        .filter((w) => w.group !== groupToAdd)
        .map((w, i) => ({ name: `${w.name} - ${w.balance} TEA (${w.address.substring(0, 8)}...)`, value: i }))

      if (walletOptions.length === 0) {
        console.log(chalk.yellow(`\nSemua dompet sudah berada dalam grup "${groupToAdd}"`))
        return
      }

      displayMenu("PILIH DOMPET UNTUK DITAMBAHKAN", walletOptions)
      const walletIndex = await getMenuChoice(walletOptions)

      wallets[walletIndex].group = groupToAdd
      saveWallets()
      console.log(chalk.green(`\n✓ Dompet "${wallets[walletIndex].name}" berhasil ditambahkan ke grup "${groupToAdd}"`))
    } else if (action === "remove_wallet") {
      const groupOptions = Object.keys(walletGroups).map((g) => ({ name: g, value: g }))

      displayMenu("PILIH GRUP", groupOptions)
      const groupToRemove = await getMenuChoice(groupOptions)

      const walletOptions = wallets
        .filter((w) => w.group === groupToRemove)
        .map((w, i) => ({ name: `${w.name} - ${w.balance} TEA (${w.address.substring(0, 8)}...)`, value: i }))

      if (walletOptions.length === 0) {
        console.log(chalk.yellow(`\nTidak ada dompet dalam grup "${groupToRemove}"`))
        return
      }

      displayMenu("PILIH DOMPET UNTUK DIHAPUS", walletOptions)
      const walletIndex = await getMenuChoice(walletOptions)

      wallets[walletIndex].group = "default"
      saveWallets()
      console.log(
        chalk.green(`\n✓ Dompet "${wallets[walletIndex].name}" berhasil dihapus dari grup "${groupToRemove}"`),
      )
    } else if (action === "display_group") {
      const groupOptions = Object.keys(walletGroups).map((g) => ({ name: g, value: g }))

      displayMenu("PILIH GRUP", groupOptions)
      const groupToDisplay = await getMenuChoice(groupOptions)

      displayWallets(groupToDisplay)
    }
  }

  async function telegramSingleMenu() {
    if (wallets.length === 0) {
      console.log(chalk.yellow("\nTidak ada dompet ditemukan. Buat beberapa dompet terlebih dahulu."))
      return
    }

    const walletOptions = wallets.map((w, i) => ({
      name: `${w.name} - ${w.balance} TEA (${w.address.substring(0, 8)}...)`,
      value: i,
    }))

    displayMenu("PILIH DOMPET", walletOptions)
    const walletIndex = await getMenuChoice(walletOptions)

    await sendWalletToTelegram(walletIndex)
  }

  async function displayWalletsMenu() {
    const options = [
      { name: "📋 Semua dompet", value: "all" },
      { name: "👥 Dompet dalam grup", value: "group" },
      { name: "↩️ Kembali ke Menu Utama", value: "back" },
    ]

    displayMenu("TAMPILKAN DOMPET", options)
    const action = await getMenuChoice(options)

    if (action === "back") return

    if (action === "all") {
      displayWallets()
    } else if (action === "group") {
      const groups = [...new Set(wallets.map((w) => w.group || "default"))]
      const groupOptions = groups.map((g) => ({ name: g, value: g }))

      displayMenu("PILIH GRUP", groupOptions)
      const group = await getMenuChoice(groupOptions)

      displayWallets(group)
    }
  }

  async function searchWalletMenu() {
    const { searchTerm } = await inquirer.prompt([
      {
        type: "input",
        name: "searchTerm",
        message: chalk.magenta("Masukkan kata kunci pencarian (nama atau alamat):"),
      },
    ])

    const searchResults = wallets.filter(
      (w) =>
        w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        w.address.toLowerCase().includes(searchTerm.toLowerCase()),
    )

    if (searchResults.length === 0) {
      console.log(chalk.yellow("\nTidak ada dompet ditemukan dengan kata kunci tersebut."))
      return
    }

    const boxWidth = 85
    console.log(
      chalk.green("\n╔═════════════════════════════════════════════════════════════════════════════════════════════╗"),
    )
    console.log(
      chalk.green("║                                    HASIL PENCARIAN DOMPET                                    ║"),
    )
    console.log(
      chalk.green("╠═════════════════════════════════════════════════════════════════════════════════════════════╣"),
    )

    searchResults.forEach((wallet, index) => {
      const shortAddr = `${wallet.address.substring(0, 6)}...${wallet.address.substring(38)}`
      const line = `${(index + 1).toString().padStart(2)} ${wallet.name.padEnd(25)} ${shortAddr.padEnd(45)} ${wallet.balance.padStart(8)} TEA`
      console.log(chalk.green("║ ") + chalk.yellow(line.padEnd(boxWidth - 4)) + chalk.green(" ║"))
    })

    console.log(
      chalk.green("╚═════════════════════════════════════════════════════════════════════════════════════════════╝"),
    )
  }

  async function walletStatsMenu() {
    const options = [
      { name: "📊 Semua dompet", value: "all" },
      { name: "📊 Dompet tertentu", value: "specific" },
      { name: "📊 Dompet dalam grup", value: "group" },
      { name: "↩️ Kembali ke Menu Utama", value: "back" },
    ]

    displayMenu("MENU STATISTIK DOMPET", options)
    const action = await getMenuChoice(options)

    if (action === "back") return

    if (action === "all") {
      const boxWidth = 85
      console.log(
        chalk.green(
          "\n╔═════════════════════════════════════════════════════════════════════════════════════════════╗",
        ),
      )
      console.log(
        chalk.green("║                                    STATISTIK SEMUA DOMPET                                    ║"),
      )
      console.log(
        chalk.green("╠═════════════════════════════════════════════════════════════════════════════════════════════╣"),
      )

      wallets.forEach((wallet, index) => {
        const stats = walletStats[wallet.address] || { txCount: 0 }
        const walletName = `${index + 1}. ${wallet.name}`
        console.log(chalk.green(`║ ${walletName.padEnd(boxWidth - 4)} ║`))

        const addressText = `Alamat: ${wallet.address}`
        console.log(chalk.green(`║   ${addressText.padEnd(boxWidth - 6)} ║`))

        const statsText = `Transaksi: ${stats.txCount.toString().padEnd(10)} Masuk: ${stats.txInCount.toString().padEnd(10)} Keluar: ${stats.txOutCount.toString().padEnd(10)}`
        console.log(chalk.green(`║   ${statsText.padEnd(boxWidth - 6)} ║`))

        console.log(
          chalk.green(
            "╠═════════════════════════════════════════════════════════════════════════════════════════════╣",
          ),
        )
      })

      console.log(
        chalk.green("╚═════════════════════════════════════════════════════════════════════════════════════════════╝"),
      )
    } else if (action === "specific") {
      const walletOptions = wallets.map((w, i) => ({
        name: `${w.name} - ${w.balance} TEA (${w.address.substring(0, 8)}...)`,
        value: i,
      }))

      displayMenu("PILIH DOMPET", walletOptions)
      const walletIndex = await getMenuChoice(walletOptions)
      const wallet = wallets[walletIndex]
      const stats = walletStats[wallet.address] || { txCount: 0 }

      const boxWidth = 85
      console.log(
        chalk.green(
          "\n╔═════════════════════════════════════════════════════════════════════════════════════════════╗",
        ),
      )

      const titleText = `STATISTIK DOMPET: ${wallet.name}`
      console.log(chalk.green(`║                                ${titleText.padEnd(boxWidth - 35)} ║`))

      console.log(
        chalk.green("╠═════════════════════════════════════════════════════════════════════════════════════════════╣"),
      )

      const addressText = `Alamat: ${wallet.address}`
      console.log(chalk.green(`║   ${addressText.padEnd(boxWidth - 6)} ║`))

      const statsText = `Transaksi: ${stats.txCount.toString().padEnd(10)} Masuk: ${stats.txInCount.toString().padEnd(10)} Keluar: ${stats.txOutCount.toString().padEnd(10)}`
      console.log(chalk.green(`║   ${statsText.padEnd(boxWidth - 6)} ║`))

      console.log(
        chalk.green("╚═════════════════════════════════════════════════════════════════════════════════════════════╝"),
      )
    } else if (action === "group") {
      const groups = [...new Set(wallets.map((w) => w.group || "default"))]
      const groupOptions = groups.map((g) => ({ name: g, value: g }))

      displayMenu("PILIH GRUP", groupOptions)
      const group = await getMenuChoice(groupOptions)

      const groupWallets = wallets.filter((w) => (w.group || "default") === group)

      const boxWidth = 85
      console.log(
        chalk.green(
          "\n╔═════════════════════════════════════════════════════════════════════════════════════════════╗",
        ),
      )

      const titleText = `STATISTIK GRUP: ${group}`
      console.log(chalk.green(`║                                ${titleText.padEnd(boxWidth - 35)} ║`))

      console.log(
        chalk.green("╠═════════════════════════════════════════════════════════════════════════════════════════════╣"),
      )

      groupWallets.forEach((wallet, index) => {
        const stats = walletStats[wallet.address] || { txCount: 0 }
        const walletName = `${index + 1}. ${wallet.name}`
        console.log(chalk.green(`║ ${walletName.padEnd(boxWidth - 4)} ║`))

        const addressText = `Alamat: ${wallet.address}`
        console.log(chalk.green(`║   ${addressText.padEnd(boxWidth - 6)} ║`))

        const statsText = `Transaksi: ${stats.txCount.toString().padEnd(10)} Masuk: ${stats.txInCount.toString().padEnd(10)} Keluar: ${stats.txOutCount.toString().padEnd(10)}`
        console.log(chalk.green(`║   ${statsText.padEnd(boxWidth - 6)} ║`))

        console.log(
          chalk.green(
            "╠═════════════════════════════════════════════════════════════════════════════════════════════╣",
          ),
        )
      })

      console.log(
        chalk.green("╚═════════════════════════════════════════════════════════════════════════════════════════════╝"),
      )
    }
  }

  async function monitoringMenu() {
    const options = [
      { name: "▶️ Mulai Monitoring", value: "start" },
      { name: "⏸️ Hentikan Monitoring", value: "stop" },
      { name: "↩️ Kembali ke Menu Utama", value: "back" },
    ]

    displayMenu("MENU MONITORING SALDO", options)
    const action = await getMenuChoice(options)

    if (action === "back") return

    if (action === "start") {
      await startBalanceMonitoring()
    } else if (action === "stop") {
      await stopBalanceMonitoring()
    }
  }

  switch (action) {
    case "generate":
      await generateWalletMenu()
      break
    case "generate_multiple":
      await generateMultipleWalletsMenu()
      break
    case "import":
      await importWalletMenu()
      break
    case "check_balance":
      await checkBalanceMenu()
      break
    case "send":
      await sendTEAMenu()
      break
    case "schedule":
      await scheduleTransactionMenu()
      break
    case "send_multiple":
      await sendMultipleMenu()
      break
    case "manage_groups":
      await manageGroupsMenu()
      break
    case "telegram_single":
      await telegramSingleMenu()
      break
    case "telegram_all":
      await sendAllWalletsToTelegram()
      break
    case "display":
      await displayWalletsMenu()
      break
    case "search":
      await searchWalletMenu()
      break
    case "stats":
      await walletStatsMenu()
      break
    case "monitoring":
      await monitoringMenu()
      break
    case "backup":
      await backupMenu()
      break
    case "report":
      await sendDailyReport()
      break
    case "delete":
      await deleteWalletMenu()
      break
    case "exit":
      console.log(chalk.green("\nTerima kasih telah menggunakan TEA Wallet Manager — Powered by edosetiawan.tea"))
      process.exit(0)
  }

  await inquirer.prompt([
    {
      type: "input",
      name: "continue",
      message: chalk.magenta("Tekan Enter untuk melanjutkan..."),
    },
  ])

  mainMenu()
}

console.clear()
console.log(banner)
console.log(chalk.cyan("Memuat dompet..."))
loadWallets()
loadWalletGroups()
loadWalletStats()

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir)
}

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.log(chalk.yellow("⚠️ Notifikasi Telegram tidak dikonfigurasi."))
  console.log(chalk.yellow("Untuk mengaktifkan notifikasi Telegram, buat file .env dengan:"))
  console.log(chalk.white("TELEGRAM_BOT_TOKEN=token_bot_anda"))
  console.log(chalk.white("TELEGRAM_CHAT_ID=id_chat_anda"))
}

setupAutomaticBackup()
setupDailyReport()

setTimeout(() => {
  mainMenu()
}, 1000)
