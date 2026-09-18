const values: number[] = [1, 2, 3, 4];

export const doubledEvens = values.filter((value) => value % 2 === 0).map((value) => value * 2);
