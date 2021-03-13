import Big from 'big.js';
import { STOCKS, EXPECT_LOSS_RATE, ADVICE_LOSS_RATE } from '../constants';

// eslint-disable-next-line no-extend-native
String.prototype.replaceAt = function (index, replacement) {
  return this.substr(0, index) + replacement + this.substr(index + 1);
};

// 对股票id进行处理
export function getStockCodes(stocks = []) {
  return stocks.map((code) => {
    if (isNaN(code[0])) {
      if (code.toLowerCase().indexOf('us_') > -1) {
        return code.toUpperCase();
      } else if (code.indexOf('hk') > -1) {
        return code;
      } else {
        return code.toLowerCase().replace('sz', '1').replace('sh', '0');
      }
    } else {
      return (code[0] === '6' ? '0' : '1') + code;
    }
  });
}

// 生成补仓函数
export function genFnForBC(stocks = []) {
  return stocks.map((stock) => {
    stock.bcFn = `((${stock.position}+x)${stock.price})/(${stock.costPrice}*${stock.position} + ${stock.price}x)`;
    return stock;
  });
}

export function soryBy(key, type) {}

/**
 * 根据反比函数公式，求一个最小近似值
 * @param {*} formula 公式，变量为x
 * @param {*} targetValue 目标值
 */
function calcApproximateValue(formula = '', targetValue, options = {}) {
  const { step = 1, startX = 0, endX, cycleCount = 300 } = options;
  let realCycleCount = endX ? endX - startX + 1 : cycleCount;
  let count = 0;
  let i = 0;
  let resultMap = {};

  while (count < realCycleCount) {
    const vX = step + i;
    const formulaStr = putIntoFormula(formula, 'x', vX);
    // eslint-disable-next-line no-eval
    const result = eval(formulaStr);
    const delta = Math.abs(result - targetValue);

    resultMap[delta] = { x: vX, y: result, times: count };
    i += step;
    count++;
  }
  const minDelta = Math.min(...Object.keys(resultMap));
  const approObj = resultMap[minDelta];

  return {
    formula,
    x: approObj.x,
    y: approObj.y,
    targetValue,
    approValue: approObj.y,
    step,
  };
}

//格式华
export function formatToLocalStocks(stocks = []) {
  return stocks.map((stock) => ({
    name: stock.name,
    symbol: stock.symbol,
    costPrice: stock.costPrice,
    position: stock.position,
    pe: stock.pe,
    eps: stock.eps,
    profits: stock.profits,
    issue: stock.issue,
  }));
}

// 初始化数据
export function initData() {
  if (!localStorage.getItem('pageView')) {
    localStorage.setItem('stocks', JSON.stringify(STOCKS));
    localStorage.setItem('pageView', 1);
  } else {
    const pageView = localStorage.getItem('pageView');
    localStorage.setItem('pageView', Number(pageView) + 1);
  }
}

// 重置数据
export function resetData(defaultJson = STOCKS) {
  localStorage.setItem('stocks', JSON.stringify(defaultJson));
}

// 合并本地和接口数据
export function mergeStocks(serverStocks) {
  const localStockStr = localStorage.getItem('stocks');
  const STOCKS = localStockStr ? JSON.parse(localStockStr) : [];
  const stockMap = Object.values(serverStocks).reduce((sum, stock) => {
    sum[stock.symbol] = stock;
    return sum;
  }, {});
  // 合并成本价、持仓信息
  const stocks = STOCKS.map((localStock) => {
    if (stockMap[localStock.symbol]) {
      const stockItem = {
        ...localStock,
        ...stockMap[localStock.symbol],
      };
      // 每股计算的建议信息
      let advice = {};
      const { costPrice, price, position } = stockItem;

      if (costPrice > price) {
        stockItem.bcFn = `1-(${(position * price).toFixed(2)}+${price}x)/(${(costPrice * position).toFixed(
          2,
        )}+${price}x)`;
      } else {
        stockItem.jcFn = `(${(position * price).toFixed(2)}+${price}x)/(${(costPrice * position).toFixed(
          2,
        )}+${price}x)-1`;
      }
      stockItem.earnRate = price / costPrice - 1;

      if (stockItem.earnRate < ADVICE_LOSS_RATE) {
        advice = calcApproximateValue(stockItem.bcFn, -EXPECT_LOSS_RATE, { step: 100 });
        advice.amount = (advice.x * stockItem.price).toFixed(2);
      }

      stockItem.advice = advice;
      return stockItem;
    } else {
      return localStock;
    }
  });

  return [...stocks];
}

// 计算持仓汇总信息
export function calcStockSummary(stockList) {
  let summary = {
    // 市值
    marketValue: 0,
    // 成本金额
    costValue: 0,
    // 盈亏金额
    earnMoney: 0,
    // 平均盈亏率
    earnRate: 0,
    // 建议
    advice: {
      // 建议流动资金
      hotMoney: 0,
    },
    // 盈亏统计
    earn: {
      // 最小盈亏比
      minRate: 0,
      // 最大盈亏比
      maxRate: 0,
      // 最小盈亏金额
      minMoney: 0,
      // 最大盈亏金额
      maxMoney: 0,
      // 盈亏比绝对值最大值
      maxAbsRate: 0,
    },
  };

  summary = stockList.reduce((sum, item) => {
    const adviceAmount = item.advice ? item.advice.amount : 0;

    sum.marketValue = new Big(item.price).times(item.position).plus(sum.marketValue).valueOf();

    sum.costValue = new Big(item.costPrice).times(item.position).plus(sum.costValue).valueOf();

    sum.advice.hotMoney = new Big(sum.advice.hotMoney).plus(Number(adviceAmount || 0)).valueOf();

    return sum;
  }, summary);

  summary.earnRate = new Big(summary.marketValue).div(summary.costValue).minus(1).toFixed(4).valueOf();
  summary.earnMoney = new Big(summary.marketValue).minus(summary.costValue).valueOf();

  if (stockList && stockList.length > 0) {
    const sortedByEarnRateList = stockList.sort((a, b) => a.earnRate - b.earnRate);
    // 最小收益股票
    const minRateStock = sortedByEarnRateList[0];
    // 最大收益股票
    const maxRateStock = sortedByEarnRateList[sortedByEarnRateList.length - 1];

    summary.earn.minRate = minRateStock.earnRate;
    summary.earn.maxRate = maxRateStock.earnRate;

    summary.earn.minMoney = (minRateStock.earnRate * minRateStock.costPrice * minRateStock.position).toFixed(2);
    summary.earn.maxMoney = (maxRateStock.earnRate * maxRateStock.costPrice * maxRateStock.position).toFixed(2);

    summary.earn.maxAbsRate = Math.max(Math.abs(minRateStock.earnRate), Math.abs(maxRateStock.earnRate));
  }

  return summary;
}

/**
 * 求一个数的倍数
 *
 * @param n number
 * @param m 最小起倍数
 * @param options
 */
export function toMultiple(n, m, options = {}) {
  let n1 = Number(n);
  let m1 = Number(m);
  // 返回值 是向上取整[ceil]，还是向下取整数[floor]
  const { to = 'ceil' } = options;
  const times = Math.floor(n1 / m1);

  if (n1 === m1 || n1 % m1 === 0) {
    return n1;
  }

  switch (to) {
    case 'ceil': {
      return Big(times).plus(1).times(m1).valueOf();
    }
    case 'floor': {
      return Big(times).times(m1).valueOf();
    }
    default: {
      return Big(times).plus(1).times(m1).valueOf();
    }
  }
}

/**
 * 代入变量到公式
 * @param {*} formula 公式
 * @param {*} variableKey 变量key
 * @param {*} variable 代入变量值
 */
function putIntoFormula(formula, variableKey, variable) {
  const matchs = formula.match(new RegExp(variableKey, 'gi'));
  let newFormula = formula;

  if (matchs.length) {
    matchs.forEach(() => {
      const variableIdx = newFormula.indexOf(variableKey);
      const prevChart = newFormula[variableIdx - 1];
      const nextChart = newFormula[variableIdx + 1];

      if (variableIdx > -1) {
        if (/\d/.test(prevChart)) {
          newFormula = newFormula.replaceAt(variableIdx, `*${variable}`);
        } else if (/\d/.test(nextChart)) {
          newFormula = newFormula.replaceAt(variableIdx, `${variable}*`);
        } else {
          newFormula = newFormula.replaceAt(variableIdx, `${variable}`);
        }
      }
    });
  }

  return newFormula;
}

// 格式化模拟设置
export const formatSimulateValues = (values) => {
  const result = {};
  Object.keys(values).forEach((key) => {
    const keySplit = key.split('_');

    if (keySplit.length > 1) {
      const key0 = keySplit[0];
      const key1 = keySplit[1];

      if (result[key0]) {
        result[key0][key1] = values[key];
      } else {
        result[key0] = {
          [key1]: values[key],
        };
      }
    } else {
      result[key] = values[key];
    }
  });
  result.down.threshold = -result.down.threshold / 100;
  result.up.threshold = result.up.threshold / 100;
  result.up.position = -result.up.position;
  return result;
};

/**
 * 更新本地股票持仓
 *
 * @export
 * @param {*} key
 * @param {*} newValues
 * @returns
 */
export function updateStock(key, newValues) {
  const localStockStr = localStorage.getItem('stocks');
  const stocks = localStockStr ? JSON.parse(localStockStr) : [];

  const newStocks = stocks.map((item) => {
    if (String(item.symbol) === String(key)) {
      return {
        ...item,
        ...newValues,
      };
    } else {
      return item;
    }
  });

  localStorage.setItem('stocks', JSON.stringify(formatToLocalStocks(newStocks)));
  return newStocks;
}

export function calcTargetPrice1(values) {
  return (values.profits * values.pe) / values.issue;
}

export function calcTargetPrice2(values) {
  return values.eps * values.pe;
}