export const binarySearchInsert = (array, value, compareFn) => {
  let left = 0;
  let right = array.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const compare = compareFn(value, array[mid]);
    if (compare === 0) {
      return mid;
    } else if (compare < 0) {
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }
  return left;
};

export const addSummoner = (Summoners, userData) => {
  const compareFn = (a, b) => a.slotId - b.slotId;
  const index = binarySearchInsert(Summoners, userData, compareFn);
  const newSummoners = [...Summoners];
  if (index < newSummoners.length && newSummoners[index].slotId === userData.slotId) {
    // 如果找到相同的 slotId，替換原有的數據
    newSummoners[index] = userData;
  } else {
    // 否則，將新數據插入到正確的位置
    newSummoners.splice(index, 0, userData);
  }
  return newSummoners;
};