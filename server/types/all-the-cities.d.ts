declare module "all-the-cities" {
  type AllTheCity = {
    cityId: string | number;
    name: string;
    country: string;
    adminCode: string;
    population: number;
    loc?: {
      type: "Point";
      coordinates: [number, number];
    };
  };

  const cities: AllTheCity[];
  export default cities;
}
