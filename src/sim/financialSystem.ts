import type {
  FinancialAccountRef, FinancialObligation, FinancialObligationKind, FinancialTransaction,
  FinancialTransactionKind, WorldState,
} from '../types';
import { worldTick } from './scheduler';

const EPSILON = 0.000_001;
const MAX_FINANCIAL_HISTORY = 6000;

export interface FinancialAuditCheckpoint {
  totalMoney: number;
  nextTransactionId: number;
}

export interface MoneyTransferRequest {
  payer?: FinancialAccountRef;
  payee?: FinancialAccountRef;
  amount: number;
  kind: FinancialTransactionKind;
  purpose: string;
  settlementId?: number;
  kingdomId?: number;
  relatedMarketTransactionId?: number;
  relatedObligationId?: number;
}

export interface MoneyTransferResult {
  paid: number;
  unpaid: number;
  transaction?: FinancialTransaction;
}

function sameAccount(left: FinancialAccountRef, right: FinancialAccountRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function accountBalance(world: WorldState, account: FinancialAccountRef): number | undefined {
  switch (account.kind) {
    case 'character': return world.characters.find(item => item.id === account.id)?.wallet;
    case 'household': return world.households.find(item => item.id === account.id)?.wealth;
    case 'establishment': return world.establishments.find(item => item.id === account.id)?.cash;
    case 'settlementGovernment': return world.settlementGovernments.find(item => item.id === account.id)?.treasury;
    case 'kingdom': return world.kingdoms.find(item => item.id === account.id)?.treasury;
    case 'travelingMerchant': return world.travelingMerchants.find(item => item.id === account.id)?.cash;
    case 'politicalCommunity': return world.politicalCommunities.find(item => item.id === account.id)?.treasury;
    case 'courtFaction': return world.courtFactions.find(item => item.id === account.id)?.treasury;
  }
}

function setAccountBalance(world: WorldState, account: FinancialAccountRef, value: number): boolean {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  switch (account.kind) {
    case 'character': {
      const entity = world.characters.find(item => item.id === account.id);
      if (!entity) return false;
      entity.wallet = safe;
      return true;
    }
    case 'household': {
      const entity = world.households.find(item => item.id === account.id);
      if (!entity) return false;
      entity.wealth = safe;
      return true;
    }
    case 'establishment': {
      const entity = world.establishments.find(item => item.id === account.id);
      if (!entity) return false;
      entity.cash = safe;
      return true;
    }
    case 'settlementGovernment': {
      const entity = world.settlementGovernments.find(item => item.id === account.id);
      if (!entity) return false;
      entity.treasury = safe;
      return true;
    }
    case 'kingdom': {
      const entity = world.kingdoms.find(item => item.id === account.id);
      if (!entity) return false;
      entity.treasury = safe;
      return true;
    }
    case 'travelingMerchant': {
      const entity = world.travelingMerchants.find(item => item.id === account.id);
      if (!entity) return false;
      entity.cash = safe;
      return true;
    }
    case 'politicalCommunity': {
      const entity = world.politicalCommunities.find(item => item.id === account.id);
      if (!entity) return false;
      entity.treasury = safe;
      return true;
    }
    case 'courtFaction': {
      const entity = world.courtFactions.find(item => item.id === account.id);
      if (!entity) return false;
      entity.treasury = safe;
      return true;
    }
  }
}

export function financialAccountBalance(world: WorldState, account: FinancialAccountRef): number {
  return Math.max(0, accountBalance(world, account) ?? 0);
}

function appendFinancialTransaction(world: WorldState, transaction: Omit<FinancialTransaction, 'id' | 'tick'>): FinancialTransaction {
  world.financialTransactions ??= [];
  world.nextIds.financialTransaction ??= Math.max(0, ...world.financialTransactions.map(item => item.id)) + 1;
  const created: FinancialTransaction = {
    id: world.nextIds.financialTransaction++,
    tick: worldTick(world),
    ...transaction,
  };
  world.financialTransactions.push(created);
  if (world.financialTransactions.length > MAX_FINANCIAL_HISTORY) {
    world.financialTransactions.splice(0, world.financialTransactions.length - MAX_FINANCIAL_HISTORY);
  }
  return created;
}

export function transferMoney(world: WorldState, request: MoneyTransferRequest): MoneyTransferResult {
  const requested = Math.max(0, Number.isFinite(request.amount) ? request.amount : 0);
  if (requested <= EPSILON || (!request.payer && !request.payee)) return { paid: 0, unpaid: requested };
  if (request.payer && request.payee && sameAccount(request.payer, request.payee)) return { paid: requested, unpaid: 0 };

  const payerBalance = request.payer ? accountBalance(world, request.payer) : requested;
  if (request.payer && payerBalance === undefined) return { paid: 0, unpaid: requested };
  if (request.payee && accountBalance(world, request.payee) === undefined) return { paid: 0, unpaid: requested };

  const paid = request.payer ? Math.min(requested, Math.max(0, payerBalance ?? 0)) : requested;
  if (paid <= EPSILON) return { paid: 0, unpaid: requested };

  if (request.payer) setAccountBalance(world, request.payer, (payerBalance ?? 0) - paid);
  if (request.payee) setAccountBalance(world, request.payee, financialAccountBalance(world, request.payee) + paid);

  const transaction = appendFinancialTransaction(world, {
    settlementId: request.settlementId,
    kingdomId: request.kingdomId,
    kind: request.kind,
    payer: request.payer,
    payee: request.payee,
    requestedAmount: requested,
    amount: paid,
    unpaidAmount: Math.max(0, requested - paid),
    purpose: request.purpose,
    relatedMarketTransactionId: request.relatedMarketTransactionId,
    relatedObligationId: request.relatedObligationId,
  });
  return { paid, unpaid: Math.max(0, requested - paid), transaction };
}

function obligationMatches(
  obligation: FinancialObligation,
  debtor: FinancialAccountRef,
  creditor: FinancialAccountRef,
  kind: FinancialObligationKind,
  purpose: string,
): boolean {
  return obligation.status !== 'paid'
    && sameAccount(obligation.debtor, debtor)
    && sameAccount(obligation.creditor, creditor)
    && obligation.kind === kind
    && obligation.purpose === purpose;
}

export function setFinancialObligation(
  world: WorldState,
  data: {
    debtor: FinancialAccountRef;
    creditor: FinancialAccountRef;
    kind: FinancialObligationKind;
    amount: number;
    purpose: string;
    dueTick?: number;
    settlementId?: number;
    kingdomId?: number;
  },
): FinancialObligation | undefined {
  world.financialObligations ??= [];
  world.nextIds.financialObligation ??= Math.max(0, ...world.financialObligations.map(item => item.id)) + 1;
  const amount = Math.max(0, data.amount);
  const existing = world.financialObligations.find(item => obligationMatches(item, data.debtor, data.creditor, data.kind, data.purpose));
  if (existing) {
    existing.outstandingAmount = amount;
    existing.originalAmount = Math.max(existing.originalAmount, amount);
    existing.status = amount <= EPSILON ? 'paid' : amount < existing.originalAmount ? 'partial' : 'open';
    if (amount <= EPSILON) existing.lastPaymentTick = worldTick(world);
    return existing;
  }
  if (amount <= EPSILON) return undefined;
  const obligation: FinancialObligation = {
    id: world.nextIds.financialObligation++,
    createdTick: worldTick(world),
    dueTick: data.dueTick ?? worldTick(world) + 1,
    debtor: data.debtor,
    creditor: data.creditor,
    kind: data.kind,
    originalAmount: amount,
    outstandingAmount: amount,
    status: 'open',
    purpose: data.purpose,
    settlementId: data.settlementId,
    kingdomId: data.kingdomId,
  };
  world.financialObligations.push(obligation);
  return obligation;
}

export function addFinancialObligation(
  world: WorldState,
  data: Omit<Parameters<typeof setFinancialObligation>[1], 'amount'> & { amount: number },
): FinancialObligation | undefined {
  const existing = world.financialObligations?.find(item => obligationMatches(item, data.debtor, data.creditor, data.kind, data.purpose));
  return setFinancialObligation(world, {
    ...data,
    amount: (existing?.outstandingAmount ?? 0) + Math.max(0, data.amount),
  });
}

export function payFinancialObligations(
  world: WorldState,
  debtor: FinancialAccountRef,
  maximumAmount: number,
  kinds?: ReadonlySet<FinancialObligationKind>,
): number {
  let budget = Math.max(0, maximumAmount);
  let paidTotal = 0;
  const obligations = (world.financialObligations ?? [])
    .filter(item => item.status !== 'paid' && sameAccount(item.debtor, debtor) && (!kinds || kinds.has(item.kind)))
    .sort((a, b) => a.dueTick - b.dueTick || a.id - b.id);
  for (const obligation of obligations) {
    if (budget <= EPSILON) break;
    const requested = Math.min(budget, obligation.outstandingAmount);
    const result = transferMoney(world, {
      payer: obligation.debtor,
      payee: obligation.creditor,
      amount: requested,
      kind: 'debtPayment',
      purpose: `погашение обязательства: ${obligation.purpose}`,
      settlementId: obligation.settlementId,
      kingdomId: obligation.kingdomId,
      relatedObligationId: obligation.id,
    });
    if (result.paid <= EPSILON) break;
    obligation.outstandingAmount = Math.max(0, obligation.outstandingAmount - result.paid);
    obligation.lastPaymentTick = worldTick(world);
    obligation.status = obligation.outstandingAmount <= EPSILON ? 'paid' : 'partial';
    budget -= result.paid;
    paidTotal += result.paid;
  }
  return paidTotal;
}

export function outstandingFinancialDebt(world: WorldState, debtor: FinancialAccountRef): number {
  return (world.financialObligations ?? [])
    .filter(item => item.status !== 'paid' && sameAccount(item.debtor, debtor))
    .reduce((sum, item) => sum + Math.max(0, item.outstandingAmount), 0);
}

export function totalMoneySupply(world: WorldState): number {
  const characters = world.characters.reduce((sum, item) => sum + Math.max(0, item.wallet ?? 0), 0);
  const households = world.households.reduce((sum, item) => sum + Math.max(0, item.wealth), 0);
  const establishments = world.establishments.reduce((sum, item) => sum + Math.max(0, item.cash), 0);
  const localGovernments = world.settlementGovernments.reduce((sum, item) => sum + Math.max(0, item.treasury), 0);
  const kingdoms = world.kingdoms.reduce((sum, item) => sum + Math.max(0, item.treasury), 0);
  const merchants = world.travelingMerchants.reduce((sum, item) => sum + Math.max(0, item.cash), 0);
  const communities = world.politicalCommunities.reduce((sum, item) => sum + Math.max(0, item.treasury), 0);
  const factions = world.courtFactions.reduce((sum, item) => sum + Math.max(0, item.treasury), 0);
  return characters + households + establishments + localGovernments + kingdoms + merchants + communities + factions;
}

export function refreshSettlementCoinSupply(world: WorldState, settlementId?: number): void {
  const settlementIds = settlementId === undefined ? world.settlements.map(item => item.id) : [settlementId];
  for (const id of settlementIds) {
    const settlement = world.settlements.find(item => item.id === id);
    if (!settlement) continue;
    const householdIds = new Set(world.households.filter(item => item.settlementId === id).map(item => item.id));
    const total = world.households.filter(item => item.settlementId === id).reduce((sum, item) => sum + Math.max(0, item.wealth), 0)
      + world.characters.filter(item => item.settlementId === id && (!item.householdId || householdIds.has(item.householdId))).reduce((sum, item) => sum + Math.max(0, item.wallet ?? 0), 0)
      + world.establishments.filter(item => item.settlementId === id).reduce((sum, item) => sum + Math.max(0, item.cash), 0)
      + world.settlementGovernments.filter(item => item.settlementId === id).reduce((sum, item) => sum + Math.max(0, item.treasury), 0)
      + world.travelingMerchants.filter(item => item.currentSettlementId === id).reduce((sum, item) => sum + Math.max(0, item.cash), 0);
    settlement.economy.coinSupply = total;
  }
}

export function initializeFinancialSystem(world: WorldState): void {
  world.financialTransactions ??= [];
  world.financialObligations ??= [];
  world.nextIds.financialTransaction ??= Math.max(0, ...world.financialTransactions.map(item => item.id)) + 1;
  world.nextIds.financialObligation ??= Math.max(0, ...world.financialObligations.map(item => item.id)) + 1;
  world.simulation.financialSystemVersion = 1;
  refreshSettlementCoinSupply(world);
  world.simulation.financeAudit ??= {
    lastTick: worldTick(world),
    totalMoney: totalMoneySupply(world),
    expectedExternalDelta: 0,
    unexplainedDelta: 0,
    transactionCount: world.financialTransactions.length,
    openObligationTotal: world.financialObligations.filter(item => item.status !== 'paid').reduce((sum, item) => sum + item.outstandingAmount, 0),
  };
}

export function beginFinancialAudit(world: WorldState): FinancialAuditCheckpoint {
  initializeFinancialSystem(world);
  return {
    totalMoney: totalMoneySupply(world),
    nextTransactionId: world.nextIds.financialTransaction ?? 1,
  };
}

export function completeFinancialAudit(world: WorldState, checkpoint: FinancialAuditCheckpoint): void {
  const transactions = world.financialTransactions.filter(item => item.id >= checkpoint.nextTransactionId);
  const expectedExternalDelta = transactions.reduce((sum, item) => {
    if (!item.payer && item.payee) return sum + item.amount;
    if (item.payer && !item.payee) return sum - item.amount;
    return sum;
  }, 0);
  const total = totalMoneySupply(world);
  const actualDelta = total - checkpoint.totalMoney;
  refreshSettlementCoinSupply(world);
  world.simulation.financeAudit = {
    lastTick: worldTick(world),
    totalMoney: total,
    expectedExternalDelta,
    unexplainedDelta: actualDelta - expectedExternalDelta,
    transactionCount: transactions.length,
    openObligationTotal: world.financialObligations.filter(item => item.status !== 'paid').reduce((sum, item) => sum + item.outstandingAmount, 0),
  };
}

export function financialIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const accountGroups: Array<[string, Array<{ id: number; value: number }>]> = [
    ['персонаж', world.characters.map(item => ({ id: item.id, value: item.wallet ?? 0 }))],
    ['семья', world.households.map(item => ({ id: item.id, value: item.wealth }))],
    ['заведение', world.establishments.map(item => ({ id: item.id, value: item.cash }))],
    ['местная казна', world.settlementGovernments.map(item => ({ id: item.id, value: item.treasury }))],
    ['казна державы', world.kingdoms.map(item => ({ id: item.id, value: item.treasury }))],
    ['странствующий торговец', world.travelingMerchants.map(item => ({ id: item.id, value: item.cash }))],
  ];
  for (const [label, accounts] of accountGroups) {
    for (const account of accounts) if (!Number.isFinite(account.value) || account.value < -EPSILON) issues.push(`${label} ${account.id}: недопустимый денежный остаток ${account.value}`);
  }
  for (const transaction of world.financialTransactions ?? []) {
    if (!Number.isFinite(transaction.amount) || transaction.amount <= 0) issues.push(`Проводка ${transaction.id}: недопустимая сумма`);
    if (transaction.unpaidAmount < -EPSILON || transaction.amount - transaction.requestedAmount > EPSILON) issues.push(`Проводка ${transaction.id}: нарушено соотношение оплаченной и запрошенной суммы`);
    if (!transaction.payer && !transaction.payee) issues.push(`Проводка ${transaction.id}: нет ни плательщика, ни получателя`);
  }
  for (const obligation of world.financialObligations ?? []) {
    if (obligation.outstandingAmount < -EPSILON || obligation.originalAmount + EPSILON < obligation.outstandingAmount) issues.push(`Обязательство ${obligation.id}: недопустимый остаток`);
    if (obligation.status === 'paid' && obligation.outstandingAmount > EPSILON) issues.push(`Обязательство ${obligation.id}: помечено оплаченным при остатке ${obligation.outstandingAmount}`);
  }
  const unexplained = world.simulation.financeAudit?.unexplainedDelta ?? 0;
  if (Math.abs(unexplained) > .001) issues.push(`Финансовый аудит: необъяснимое изменение денежной массы ${unexplained.toFixed(4)}`);
  return issues;
}
