export const __create = Object.create;
export const __defProp = Object.defineProperty;
export const __getOwnPropDesc = Object.getOwnPropertyDescriptor;
export const __getOwnPropNames = Object.getOwnPropertyNames;
export const __getProtoOf = Object.getPrototypeOf;
export const __hasOwnProp = Object.prototype.hasOwnProperty;

export const __copyProps = (
  to: any,
  from: any,
  except?: string,
  _desc?: PropertyDescriptor
) => {
  if (from && (typeof from === "object" || typeof from === "function")) {
    for (const key of __getOwnPropNames(from)) {
      if (!__hasOwnProp.call(to, key) && key !== except) {
        const desc = __getOwnPropDesc(from, key);
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !desc || desc.enumerable,
        });
      }
    }
  }
  return to;
};

export const __toESM = (mod: any, isNodeMode?: boolean, target?: any) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  return __copyProps(
    isNodeMode || !mod || !mod.__esModule
      ? __defProp(target, "default", { value: mod, enumerable: true })
      : target,
    mod
  );
};
